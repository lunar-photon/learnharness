"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { attemptsOf, calibration, gradeResponse, totalXp, type ExamDefinition, type ExamSummary, type TestRecord, type TestScore } from "@/src/core";
import { MessageResponse } from "@/components/ai-elements/message";

export interface ExamResultData {
	exam: ExamDefinition;
	test: TestRecord;
	score: TestScore;
	summary: ExamSummary;
}

const btn = "rounded-sm border border-border bg-card px-3 py-1.5 font-ui text-xs text-foreground transition-colors hover:border-muted-foreground/50 hover:bg-accent cursor-pointer disabled:opacity-50";
const pct = (x: number) => `${Math.round(x * 100)}%`;

function answerText(test: TestRecord, qid: string, answer: { choices?: number[]; value?: number }): string {
	const q = test.questions.find((x) => x.id === qid)!;
	if (q.type === "numeric") return answer.value === undefined ? "—" : String(answer.value);
	return answer.choices?.length ? answer.choices.map((c) => c + 1).join(", ") : "—";
}

/** The result page: calibrated, specific, and pointed at what comes next. */
export function ExamResult({ data }: { data: ExamResultData }) {
	const { exam, test, score, summary } = data;
	const router = useRouter();
	const [starting, setStarting] = useState<string | null>(null);
	const attempts = attemptsOf(test, test.submittedAt ?? new Date().toISOString(), () => "local");
	const xp = totalXp(attempts);
	const calib = calibration(attempts).filter((b) => b.n > 0);
	// Each question counts once, under its main topic, so the rows add up to the test.
	const topics = [...new Set(test.questions.map((q) => q.topics[0] ?? "Other"))].map((topic) => {
		const as = attempts.filter((a) => (a.topics[0] ?? "Other") === topic);
		return { topic, n: as.length, right: as.filter((a) => a.correct).length, avg: Math.round(as.reduce((s, a) => s + a.timeSec, 0) / Math.max(1, as.length)) };
	}).sort((a, b) => a.right / a.n - b.right / b.n);
	const next = summary.focus.slice(0, 4);

	const startLesson = async (topic: string) => {
		setStarting(topic);
		const missed = test.questions.filter((q) => q.topics.includes(topic) && gradeResponse(q, test.responses[q.id]) !== true).slice(0, 3);
		const prompt = `I'm preparing for ${exam.name}. Teach me ${topic} so I can answer past-paper questions on it without difficulty.${missed.length ? ` In my last test I missed these:\n\n${missed.map((q, i) => `${i + 1}. ${q.question}`).join("\n\n")}` : ""}`;
		const res = await fetch("/api/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `${exam.name}: ${topic}` }) });
		const body = await res.json().catch(() => null);
		if (!res.ok || !body?.id) { setStarting(null); return; }
		router.push(`/chat/${body.id}?prompt=${encodeURIComponent(prompt)}`);
	};

	return (
		<div className="mx-auto max-w-3xl space-y-6 p-6 font-ui text-sm">
			<header className="space-y-1">
				<p className="text-muted-foreground">{exam.name} · {test.kind === "mock" ? "Mock test" : "Quiz"} result</p>
				<h1 className="text-2xl font-medium tabular-nums">{score.score} <span className="text-base text-muted-foreground">/ {score.max}</span></h1>
				<p className="text-muted-foreground">{score.correct} right · {score.wrong} wrong · {score.unanswered} unanswered, under the real marking.</p>
			</header>

			<section aria-label="Progress" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
				{[
					["XP earned", `+${xp}`],
					["Streak", `${summary.daily.streak} day${summary.daily.streak === 1 ? "" : "s"}`],
					["Today", `${summary.daily.today} / ${summary.daily.goal}`],
					["Readiness", summary.readiness.enough ? pct(summary.readiness.expected!) : "Not enough evidence"],
				].map(([label, value]) => (
					<div key={label} className="rounded-sm border border-border bg-card p-3">
						<div className="text-xs text-muted-foreground">{label}</div>
						<div className="mt-1 font-medium tabular-nums">{value}</div>
					</div>
				))}
			</section>

			<section aria-labelledby="next-title" className="space-y-2 rounded-sm border border-border bg-card p-4">
				<h2 id="next-title" className="font-medium">What happens next</h2>
				<p>Your next lessons are being planned from these results, with one goal: raising your score in the real exam. They will target:</p>
				<ul className="space-y-2">
					{next.map((f) => (
						<li key={f.topic} className="flex items-center gap-3">
							<span className="min-w-0 flex-1"><span className="font-medium">{f.topic}</span> <span className="text-muted-foreground">({f.reason})</span></span>
							<button type="button" className={btn} disabled={starting !== null} onClick={() => void startLesson(f.topic)}>
								{starting === f.topic ? "Opening…" : "Start a lesson"}
							</button>
						</li>
					))}
				</ul>
			</section>

			<section aria-labelledby="topics-title">
				<h2 id="topics-title" className="mb-2 font-medium">By topic</h2>
				<table className="w-full text-left">
					<thead className="text-xs text-muted-foreground"><tr><th className="py-1 font-normal">Topic</th><th className="font-normal">Right</th><th className="font-normal">Avg. time</th></tr></thead>
					<tbody>
						{topics.map((t) => (
							<tr key={t.topic} className="border-t border-border"><td className="py-1">{t.topic}</td><td className="tabular-nums">{t.right} / {t.n}</td><td className="tabular-nums">{t.avg}s</td></tr>
						))}
					</tbody>
				</table>
			</section>

			{calib.length > 0 && (
				<section aria-labelledby="calib-title">
					<h2 id="calib-title" className="mb-1 font-medium">Confidence vs accuracy</h2>
					<p className="mb-2 text-muted-foreground">The aim is to be exactly as sure as you are right: overconfidence costs marks on the day, underconfidence costs attempts.</p>
					<ul className="space-y-1">
						{calib.map((b) => (
							<li key={b.confidence}>
								You said <span className="font-medium">{b.confidence === 1 ? "certain" : pct(b.confidence)}</span> on {b.n} answer{b.n === 1 ? "" : "s"} and were right on {pct(b.accuracy)}
								{b.verdict === "overconfident" ? ": more sure than right." : b.verdict === "underconfident" ? ": you know more than you think." : b.verdict === "calibrated" ? ": well calibrated." : "."}
							</li>
						))}
					</ul>
				</section>
			)}

			<section aria-labelledby="review-title" className="space-y-3">
				<h2 id="review-title" className="font-medium">Review</h2>
				{test.questions.map((q, i) => {
					const r = test.responses[q.id];
					const verdict = gradeResponse(q, r);
					return (
						<article key={q.id} className="rounded-sm border border-border p-3">
							<p className="mb-1 text-xs text-muted-foreground">
								Q{i + 1} · {q.topics.join(", ")} · <span className={verdict ? "text-emerald-500" : verdict === false ? "text-destructive" : ""}>{verdict ? "Right" : verdict === false ? "Wrong" : "Unanswered"}</span>
								{r?.confidence !== undefined ? ` · you said ${r.confidence === 1 ? "certain" : pct(r.confidence)}` : ""}
								{q.origin === "pyq" ? " · real past-paper question" : ""}
							</p>
							<div className="lh-prose"><MessageResponse>{q.question}</MessageResponse></div>
							{q.options && <ol className="my-2 list-decimal pl-6">{q.options.map((o, k) => <li key={k} className={q.answer.choices?.includes(k) ? "font-medium" : ""}><MessageResponse>{o}</MessageResponse></li>)}</ol>}
							<p className="text-xs">Your answer: {answerText(test, q.id, r ?? {})} · Correct: {answerText(test, q.id, q.answer)}</p>
							{q.solution && <div className="lh-prose mt-2 border-l-2 border-border pl-3 text-muted-foreground"><MessageResponse>{q.solution}</MessageResponse></div>}
						</article>
					);
				})}
			</section>
		</div>
	);
}
