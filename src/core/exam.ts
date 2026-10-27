import type { Attempt, ExamDefinition, ExamQuestion, ExamSection, TestRecord, TestResponse } from "./contracts/exam.ts";

/**
 * Pure exam-prep logic (docs/agent-driver-plan.md §6b): grading, scoring
 * with the exam's marking, and every progress measure — XP, streak,
 * calibration, topic mastery, readiness — derived from attempts alone.
 */

const DAY_MS = 24 * 3600_000;

/** FNV-1a: a stable, browser-safe hash for the held-out split. */
function fnv1a(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
	return h >>> 0;
}

/** One PYQ in five is held out: never taught from or imitated, only used
 *  once as a readiness probe. Deterministic, so the split never drifts. */
export function isHeldOut(pyqId: string): boolean {
	return fnv1a(pyqId) % 5 === 0;
}

const sortedSet = (xs: readonly number[]) => [...new Set(xs)].sort((a, b) => a - b);

/** true / false, or null when left unanswered. An MCQ key may list several
 *  accepted options (an official key that accepts more than one). */
export function gradeResponse(q: ExamQuestion, r: TestResponse | undefined): boolean | null {
	if (!r) return null;
	if (q.type === "numeric") {
		if (r.value === undefined || !Number.isFinite(r.value) || q.answer.value === undefined) return null;
		return Math.abs(r.value - q.answer.value) <= (q.answer.tolerance ?? 0) + 1e-9;
	}
	const chosen = sortedSet(r.choices ?? []);
	if (!chosen.length) return null;
	const key = sortedSet(q.answer.choices ?? []);
	if (q.type === "mcq") return chosen.length === 1 && key.includes(chosen[0]!);
	return chosen.length === key.length && chosen.every((c, i) => c === key[i]);
}

function sectionFor(exam: ExamDefinition, name: string | undefined): ExamSection | undefined {
	return exam.sections.find((s) => s.name === name) ?? exam.sections[0];
}

export interface TestScore {
	score: number;
	max: number;
	correct: number;
	wrong: number;
	unanswered: number;
}

export function scoreTest(test: TestRecord, exam: ExamDefinition): TestScore {
	const out: TestScore = { score: 0, max: 0, correct: 0, wrong: 0, unanswered: 0 };
	for (const q of test.questions) {
		const marks = sectionFor(exam, q.section)?.marks ?? { correct: 1, wrong: 0, unanswered: 0 };
		const verdict = gradeResponse(q, test.responses[q.id]);
		out.max += marks.correct;
		if (verdict === null) { out.unanswered++; out.score += marks.unanswered; }
		else if (verdict) { out.correct++; out.score += marks.correct; }
		else { out.wrong++; out.score += marks.wrong; }
	}
	out.score = Math.round(out.score * 100) / 100;
	return out;
}

/** The attempts one submitted test produces. */
export function attemptsOf(test: TestRecord, at: string, newId: () => string): Attempt[] {
	return test.questions.map((q) => {
		const r = test.responses[q.id];
		return {
			id: newId(), examId: test.examId, testId: test.id, questionId: q.id, topics: q.topics,
			correct: gradeResponse(q, r), ...(r?.confidence !== undefined ? { confidence: r.confidence } : {}),
			timeSec: r?.timeSec ?? 0, difficulty: q.difficulty, at,
			...(q.probe ? { probe: true } : {}), ...(q.pyqId ? { pyqId: q.pyqId } : {}), ...(q.retestOf ? { retestOf: q.retestOf } : {}),
		};
	});
}

/** XP for one answer: attempting, being right, and being honestly
 *  calibrated (a proper scoring rule, so stating your true confidence
 *  always earns the most and guessing earns less than knowing). */
export function xpFor(a: Pick<Attempt, "correct" | "confidence">): number {
	if (a.correct === null) return 0;
	const y = a.correct ? 1 : 0;
	const bonus = a.confidence === undefined ? 0 : 2 * (1 - (a.confidence - y) ** 2);
	// Unrounded: rounding per answer would erase the calibration incentive.
	return 1 + 2 * y + bonus;
}

export function totalXp(attempts: readonly Attempt[]): number {
	return Math.round(attempts.reduce((sum, a) => sum + xpFor(a), 0));
}

/** Local calendar day (the learner's machine runs the app). */
export function dayKey(iso: string | number): string {
	const d = new Date(iso);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface DailyProgress {
	today: number;
	goal: number;
	streak: number;
	/** Missed days the freeze covered inside the current streak. */
	frozen: string[];
}

/** Questions answered today, and the streak of days meeting the goal.
 *  Today never breaks the streak (it is not over yet); one missed day in
 *  any seven is covered by the freeze without counting toward the streak. */
export function dailyProgress(attempts: readonly Attempt[], goal: number, now = Date.now()): DailyProgress {
	const counts = new Map<string, number>();
	let first = Infinity;
	for (const a of attempts) {
		if (a.correct === null) continue;
		const t = Date.parse(a.at);
		first = Math.min(first, t);
		const k = dayKey(t);
		counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	const met = (key: string) => (counts.get(key) ?? 0) >= goal;
	const todayKey = dayKey(now);
	let streak = met(todayKey) ? 1 : 0;
	const frozen: string[] = [];
	const tentative: string[] = [];
	// Calendar days, not 24 h steps, so daylight-saving changes cannot skip a day.
	const cursor = new Date(now);
	cursor.setHours(12, 0, 0, 0);
	let daysSinceFreeze = Infinity;
	if (Number.isFinite(first)) {
		const firstKey = dayKey(first);
		for (cursor.setDate(cursor.getDate() - 1); dayKey(cursor.getTime()) >= firstKey; cursor.setDate(cursor.getDate() - 1)) {
			const key = dayKey(cursor.getTime());
			daysSinceFreeze++;
			if (met(key)) { streak++; frozen.push(...tentative.splice(0)); continue; }
			if (daysSinceFreeze >= 7) { tentative.push(key); daysSinceFreeze = 0; continue; }
			break;
		}
	}
	// A freeze counts only when an earlier met day confirms it; trailing ones were never part of the streak.
	return { today: counts.get(todayKey) ?? 0, goal, streak, frozen };
}

export interface CalibrationBin {
	confidence: number;
	n: number;
	accuracy: number;
	verdict: "calibrated" | "overconfident" | "underconfident" | "too few";
}

const verdictOf = (n: number, gap: number): CalibrationBin["verdict"] =>
	n < 3 ? "too few" : gap < -0.15 ? "overconfident" : gap > 0.15 ? "underconfident" : "calibrated";

/** Stated confidence vs actual accuracy, per confidence level. */
export function calibration(attempts: readonly Attempt[]): CalibrationBin[] {
	const byLevel = new Map<number, Attempt[]>();
	for (const a of attempts) {
		if (a.correct === null || a.confidence === undefined) continue;
		byLevel.set(a.confidence, [...(byLevel.get(a.confidence) ?? []), a]);
	}
	return [...byLevel.entries()].sort(([a], [b]) => a - b).map(([confidence, as]) => {
		const accuracy = as.filter((a) => a.correct).length / as.length;
		return { confidence, n: as.length, accuracy, verdict: verdictOf(as.length, accuracy - confidence) };
	});
}

/** Per topic: mean stated confidence minus accuracy (positive = overconfident). */
export function confidenceGap(attempts: readonly Attempt[], topic: string): { n: number; gap: number } {
	const as = attempts.filter((a) => a.correct !== null && a.confidence !== undefined && a.topics.includes(topic));
	if (!as.length) return { n: 0, gap: 0 };
	const conf = as.reduce((s, a) => s + a.confidence!, 0) / as.length;
	const acc = as.filter((a) => a.correct).length / as.length;
	return { n: as.length, gap: conf - acc };
}

export interface TopicMastery {
	level: number;
	/** Recency-weighted accuracy estimate at the exam's level. */
	mean: number;
	/** Effective number of recent answers behind the estimate. */
	evidence: number;
}

const LEVEL_MEAN = [0, 0.5, 0.6, 0.7, 0.8, 0.9];
const HALF_LIFE_MS = 30 * DAY_MS;

/** Levels 0–5 from a recency-weighted Beta(1,1) estimate. Level k needs a
 *  mean ≥ LEVEL_MEAN[k] on at least 2k effective answers; a level rises one
 *  step at a time, at most once a day (spaced), on unseen questions; a
 *  candidate below the current level lowers it. */
export function topicMastery(attempts: readonly Attempt[], topic: string, now = Date.now()): TopicMastery {
	const as = attempts.filter((a) => a.correct !== null && a.topics.includes(topic)).sort((a, b) => a.at.localeCompare(b.at));
	let wins = 0, losses = 0, prev: number | undefined, level = 0, lastRise = -Infinity;
	const seen = new Set<string>();
	for (const a of as) {
		const t = Date.parse(a.at);
		if (prev !== undefined) { const decay = 0.5 ** ((t - prev) / HALF_LIFE_MS); wins *= decay; losses *= decay; }
		prev = t;
		if (a.correct) wins++; else losses++;
		const mean = (1 + wins) / (2 + wins + losses);
		let candidate = 0;
		for (let k = 5; k >= 1; k--) if (mean >= LEVEL_MEAN[k]! && wins + losses >= 2 * k) { candidate = k; break; }
		const fresh = !seen.has(a.questionId);
		seen.add(a.questionId);
		if (candidate > level && fresh && t - lastRise >= DAY_MS) { level++; lastRise = t; }
		else if (candidate < level) level = candidate;
	}
	if (prev !== undefined) { const decay = 0.5 ** ((now - prev) / HALF_LIFE_MS); wins *= decay; losses *= decay; }
	return { level, mean: (1 + wins) / (2 + wins + losses), evidence: wins + losses };
}

export interface Readiness {
	enough: boolean;
	probes: number;
	/** Estimated fraction of the maximum score in the real exam, with an ~80% interval. */
	expected?: number;
	low?: number;
	high?: number;
}

const MIN_PROBES = 5;

/** Readiness from first attempts on held-out PYQs only: a Beta posterior
 *  on accuracy, turned into an expected score under the exam's marking. */
export function readiness(attempts: readonly Attempt[], exam: ExamDefinition): Readiness {
	const first = new Map<string, Attempt>();
	for (const a of [...attempts].sort((x, y) => x.at.localeCompare(y.at))) if (a.probe && a.pyqId && !first.has(a.pyqId)) first.set(a.pyqId, a);
	const probes = [...first.values()];
	if (probes.length < MIN_PROBES) return { enough: false, probes: probes.length };
	const k = probes.filter((a) => a.correct).length;
	const alpha = 1 + k, beta = 1 + probes.length - k;
	const p = alpha / (alpha + beta);
	const sd = Math.sqrt((alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1)));
	const fraction = (q: number) => {
		let got = 0, max = 0;
		for (const s of exam.sections) { got += s.questionCount * (q * s.marks.correct + (1 - q) * s.marks.wrong); max += s.questionCount * s.marks.correct; }
		return max > 0 ? Math.max(0, got / max) : 0;
	};
	const clip = (x: number) => Math.min(1, Math.max(0, x));
	return { enough: true, probes: probes.length, expected: fraction(p), low: fraction(clip(p - 1.28 * sd)), high: fraction(clip(p + 1.28 * sd)) };
}

export interface FocusTopic {
	topic: string;
	weight: number;
	reason: string;
}

/** Misses at least a day old that no later question has retested yet. */
export function dueRetests(attempts: readonly Attempt[], now = Date.now()): Attempt[] {
	const retested = new Set(attempts.flatMap((a) => (a.retestOf ? [a.retestOf] : [])));
	return attempts.filter((a) => a.correct === false && !retested.has(a.questionId) && now - Date.parse(a.at) >= DAY_MS);
}

/** Where the next quiz should push: weak topics, overconfident ones, and
 *  untested ones, strongest need first. Difficulty is never part of this —
 *  questions stay at or above PYQ level whatever the weight. */
export function quizFocus(exam: ExamDefinition, attempts: readonly Attempt[], now = Date.now()): FocusTopic[] {
	return exam.topics.map((topic) => {
		const m = topicMastery(attempts, topic, now);
		const { n, gap } = confidenceGap(attempts, topic);
		if (m.evidence < 0.5) return { topic, weight: 0.8, reason: "not tested yet" };
		const over = n >= 3 && gap > 0.15;
		const under = n >= 3 && gap < -0.15;
		const weight = 1 - m.mean + (over ? 1.5 * gap : 0) + (under ? 0.3 : 0) + 0.1;
		const reason = over
			? `overconfident: about ${Math.round(gap * 100)} points more sure than accurate`
			: under ? "underconfident: right more often than you think" : `mastery ${m.level}/5`;
		return { topic, weight, reason };
	}).sort((a, b) => b.weight - a.weight);
}

/** What the test page may see: until submission, no answers, solutions or
 *  probe flags leave the server. */
export function publicTest(test: TestRecord): TestRecord {
	if (test.status === "submitted") return test;
	return { ...test, questions: test.questions.map(({ answer: _a, solution: _s, probe: _p, ...q }) => ({ ...q, answer: {} })) };
}

/** Seconds left on a started test (the server's clock is the authority). */
export function secondsLeft(test: TestRecord, now = Date.now()): number {
	if (!test.startedAt) return test.durationSec;
	return Math.max(0, Math.round(test.durationSec - (now - Date.parse(test.startedAt)) / 1000));
}

export interface ExamSummary {
	xp: number;
	daily: DailyProgress;
	readiness: Readiness;
	mastery: ({ topic: string } & TopicMastery)[];
	calibration: CalibrationBin[];
	focus: FocusTopic[];
}

export function examSummary(exam: ExamDefinition, attempts: readonly Attempt[], now = Date.now()): ExamSummary {
	return {
		xp: totalXp(attempts),
		daily: dailyProgress(attempts, exam.dailyGoal, now),
		readiness: readiness(attempts, exam),
		mastery: exam.topics.map((topic) => ({ topic, ...topicMastery(attempts, topic, now) })),
		calibration: calibration(attempts),
		focus: quizFocus(exam, attempts, now),
	};
}

/** One exam per exam-prep session, so the chat can link its dashboard. */
export function examIdForChat(chatId: string): string {
	return `exam_${chatId.replace(/^chat_/, "")}`;
}

/** What the exam agent receives after a test: the facts it debriefs from. */
export function examResultText(exam: ExamDefinition, test: TestRecord, score: TestScore, summary: ExamSummary): string {
	const byTopic = new Map<string, { n: number; right: number; conf: number[] }>();
	// Each question counts once, under its main (first) topic, so the rows add up to the test.
	for (const q of test.questions) {
		const verdict = gradeResponse(q, test.responses[q.id]);
		const topic = q.topics[0] ?? "Other";
		const t = byTopic.get(topic) ?? { n: 0, right: 0, conf: [] };
		t.n++;
		if (verdict) t.right++;
		const c = test.responses[q.id]?.confidence;
		if (c !== undefined && verdict !== null) t.conf.push(c);
		byTopic.set(topic, t);
	}
	const topics = [...byTopic.entries()].map(([topic, t]) => {
		const conf = t.conf.length ? ` (stated confidence ${Math.round((t.conf.reduce((a, b) => a + b, 0) / t.conf.length) * 100)}%)` : "";
		return `- ${topic}: ${t.right}/${t.n} right${conf}`;
	});
	const calib = summary.calibration.filter((b) => b.verdict !== "too few").map((b) => `- said ${Math.round(b.confidence * 100)}%: right ${Math.round(b.accuracy * 100)}% of ${b.n} → ${b.verdict}`);
	return [
		`The learner submitted a ${test.kind === "mock" ? "full mock test" : "quiz"} for ${exam.name}: ${score.score} / ${score.max} (${score.correct} right, ${score.wrong} wrong, ${score.unanswered} unanswered) under the real marking.`,
		`By topic:\n${topics.join("\n")}`,
		calib.length ? `Calibration so far:\n${calib.join("\n")}` : "",
		`Lessons are now planned toward, most important first: ${summary.focus.slice(0, 4).map((f) => `${f.topic} (${f.reason})`).join("; ")}.`,
		`Readiness: ${summary.readiness.enough ? `about ${Math.round(summary.readiness.expected! * 100)}% of the maximum score` : "not enough held-out evidence yet"}. Streak: ${summary.daily.streak} day(s); XP ${summary.xp}.`,
		"Debrief the learner now, following your doctrine: the score and the change since last time, where confidence and accuracy disagreed, and that the next lessons are being planned from these results to raise their exam score, naming the topics.",
	].filter(Boolean).join("\n\n");
}
