/**
 * Exam-prep maths (src/core/exam.ts) against hand-computed cases: grading,
 * negative marking, the proper-scoring XP rule, the streak with its freeze,
 * spaced mastery levels, readiness from held-out probes, quiz focus.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	calibration, dailyProgress, examResultText, examSummary, gradeResponse, isHeldOut, quizFocus, readiness, scoreTest, topicMastery, totalXp, xpFor,
} from "../src/core/exam.ts";
import type { Attempt, ExamDefinition, ExamQuestion, TestRecord } from "../src/core/contracts/exam.ts";

const q = (over: Partial<ExamQuestion>): ExamQuestion => ({ id: "q", type: "mcq", question: "?", options: ["a", "b", "c", "d"], answer: { choices: [1] }, topics: ["polity"], difficulty: 3, ...over });
const exam: ExamDefinition = {
	id: "e", name: "Test exam", folder: "X", durationMin: 60, topics: ["polity", "history", "economy"], dailyGoal: 2, chatId: "c", createdAt: "2026-10-01T00:00:00Z",
	sections: [{ name: "Main", questionCount: 100, types: ["mcq"], marks: { correct: 2, wrong: -0.5, unanswered: 0 } }],
};
const DAY = 24 * 3600_000;
const NOW = new Date(2026, 9, 27, 18, 0, 0).getTime(); // local 18:00
let seq = 0;
const at = (daysAgo: number, hour = 10) => { const d = new Date(NOW - daysAgo * DAY); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
const attempt = (over: Partial<Attempt>): Attempt => ({ id: `a${seq++}`, examId: "e", testId: "t", questionId: `q${seq}`, topics: ["polity"], correct: true, timeSec: 30, difficulty: 3, at: at(0), ...over });

describe("grading and scoring", () => {
	it("grades MCQ, multi-key MCQ, MSQ and numeric answers, with null for unanswered", () => {
		assert.equal(gradeResponse(q({}), { choices: [1], timeSec: 1 }), true);
		assert.equal(gradeResponse(q({}), { choices: [2], timeSec: 1 }), false);
		assert.equal(gradeResponse(q({}), { choices: [], timeSec: 1 }), null);
		assert.equal(gradeResponse(q({}), undefined), null);
		assert.equal(gradeResponse(q({ answer: { choices: [1, 3] } }), { choices: [3], timeSec: 1 }), true, "a key that accepts two options");
		assert.equal(gradeResponse(q({}), { choices: [1, 2], timeSec: 1 }), false, "two picks on an MCQ is wrong");
		assert.equal(gradeResponse(q({ type: "msq", answer: { choices: [0, 2] } }), { choices: [2, 0], timeSec: 1 }), true);
		assert.equal(gradeResponse(q({ type: "msq", answer: { choices: [0, 2] } }), { choices: [0], timeSec: 1 }), false);
		const num = q({ type: "numeric", options: undefined, answer: { value: 9.81, tolerance: 0.01 } });
		assert.equal(gradeResponse(num, { value: 9.8, timeSec: 1 }), true);
		assert.equal(gradeResponse(num, { value: 9.7, timeSec: 1 }), false);
	});

	it("debriefs each question once, under its main topic", () => {
		const test: TestRecord = {
			id: "t", examId: "e", kind: "quiz", status: "submitted", createdAt: "", durationSec: 600, responses: { 1: { choices: [1], timeSec: 5 } },
			questions: [{ ...q({ id: "1", topics: ["economy", "polity"] }), origin: "generated" }, { ...q({ id: "2", topics: ["polity"] }), origin: "generated" }],
		};
		const text = examResultText(exam, test, scoreTest(test, exam), examSummary(exam, []));
		assert.match(text, /- economy: 1\/1 right/);
		assert.match(text, /- polity: 0\/1 right/, "the two-topic question is not counted again under polity");
	});

	it("applies the exam's marking, including negative marks", () => {
		const test: TestRecord = {
			id: "t", examId: "e", kind: "quiz", status: "ready", createdAt: "", durationSec: 600,
			questions: [{ ...q({ id: "1" }), origin: "generated" }, { ...q({ id: "2" }), origin: "generated" }, { ...q({ id: "3" }), origin: "generated" }],
			responses: { 1: { choices: [1], timeSec: 5 }, 2: { choices: [0], timeSec: 5 } },
		};
		assert.deepEqual(scoreTest(test, exam), { score: 1.5, max: 6, correct: 1, wrong: 1, unanswered: 1 });
	});
});

describe("XP", () => {
	it("rewards knowing over guessing and honesty over bluffing", () => {
		assert.equal(xpFor({ correct: true, confidence: 1 }), 5);
		assert.equal(xpFor({ correct: false, confidence: 1 }), 1);
		assert.equal(xpFor({ correct: false, confidence: 0.5 }), 2.5);
		assert.equal(xpFor({ correct: null, confidence: 1 }), 0);
		assert.ok(xpFor({ correct: true, confidence: 1 }) > xpFor({ correct: true, confidence: 0.5 }), "hedging a known answer costs XP");
		// A blind guess on a 4-option MCQ: expected XP at each stated confidence.
		const guess = (c: number) => 0.25 * xpFor({ correct: true, confidence: c }) + 0.75 * xpFor({ correct: false, confidence: c });
		assert.ok(Math.abs(guess(0.5) - 3) < 1e-9);
		assert.ok(guess(1) < guess(0.5), "bluffing certainty on a guess earns less");
		assert.ok(guess(0.5) < xpFor({ correct: true, confidence: 1 }), "guessing earns less than knowing");
		assert.equal(totalXp([attempt({ confidence: 0.5 }), attempt({ correct: false, confidence: 0.5 })]), 7, "4.5 + 2.5, rounded only in total");
	});
});

describe("daily goal and streak", () => {
	it("counts met days, covers one missed day in seven, and never breaks on an unfinished today", () => {
		const attempts = [
			attempt({ at: at(0) }),
			attempt({ at: at(1) }), attempt({ at: at(1) }),
			// 2 days ago: missed → frozen
			attempt({ at: at(3) }), attempt({ at: at(3) }),
			attempt({ at: at(4) }), attempt({ at: at(4) }),
		];
		const p = dailyProgress(attempts, 2, NOW);
		assert.equal(p.today, 1);
		assert.equal(p.streak, 3);
		assert.equal(p.frozen.length, 1);
	});

	it("breaks on a second missed day inside the same week, and ignores unanswered questions", () => {
		const attempts = [attempt({ at: at(1) }), attempt({ at: at(1) }), attempt({ at: at(4) }), attempt({ at: at(4) }), attempt({ at: at(5) }), attempt({ at: at(5) }), attempt({ at: at(0), correct: null })];
		const p = dailyProgress(attempts, 2, NOW);
		assert.equal(p.today, 0);
		assert.equal(p.streak, 1, "days 2 and 3 both missed: one freeze only");
		assert.deepEqual(dailyProgress([], 20, NOW), { today: 0, goal: 20, streak: 0, frozen: [] });
	});
});

describe("calibration and mastery", () => {
	it("flags overconfidence per confidence level", () => {
		const as = [1, 2, 3, 4].map((i) => attempt({ confidence: 0.9, correct: i === 1 }));
		assert.deepEqual(calibration(as), [{ confidence: 0.9, n: 4, accuracy: 0.25, verdict: "overconfident" }]);
	});

	it("raises a level at most once a day, on fresh questions, and lowers it on misses", () => {
		const oneDay = Array.from({ length: 10 }, () => attempt({ at: at(0) }));
		assert.equal(topicMastery(oneDay, "polity", NOW).level, 1, "ten right answers in one day: one step");
		const fiveDays = [4, 3, 2, 1, 0].flatMap((d) => Array.from({ length: 10 }, (_, i) => attempt({ at: at(d, 9 + (i % 8)) })));
		assert.equal(topicMastery(fiveDays, "polity", NOW).level, 5);
		const repeated = [4, 3, 2, 1, 0].map((d) => attempt({ at: at(d), questionId: "same" }));
		assert.equal(topicMastery(repeated, "polity", NOW).level, 0, "the same question over and over is not evidence of mastery");
		const slump = [...fiveDays, ...Array.from({ length: 30 }, () => attempt({ at: at(0, 17), correct: false }))];
		assert.ok(topicMastery(slump, "polity", NOW).level < 5);
	});
});

describe("readiness and focus", () => {
	it("needs five held-out probes, then estimates the score under the exam's marking", () => {
		const probe = (i: number, correct: boolean) => attempt({ probe: true, pyqId: `p${i}`, correct });
		assert.deepEqual(readiness([probe(1, true), probe(2, true)], exam), { enough: false, probes: 2 });
		const r = readiness(Array.from({ length: 10 }, (_, i) => probe(i, i < 8)), exam);
		assert.equal(r.enough, true);
		// Beta(9, 3): p = 0.75 → (0.75·2 + 0.25·(−0.5)) / 2 = 0.6875
		assert.ok(Math.abs(r.expected! - 0.6875) < 1e-9);
		assert.ok(r.low! < r.expected! && r.expected! < r.high!);
		const repeat = readiness([...Array.from({ length: 10 }, (_, i) => probe(i, i < 8)), ...Array.from({ length: 10 }, (_, i) => probe(i, true))], exam);
		assert.equal(repeat.probes, 10, "only the first attempt on each probe counts");
	});

	it("holds out about a fifth of PYQs, deterministically", () => {
		const held = Array.from({ length: 2000 }, (_, i) => isHeldOut(`pyq-${i}`)).filter(Boolean).length;
		assert.ok(held > 340 && held < 460, `held out ${held}/2000`);
		assert.equal(isHeldOut("pyq-7"), isHeldOut("pyq-7"));
	});

	it("puts an overconfident topic ahead of a solid one", () => {
		const as = [
			...Array.from({ length: 6 }, (_, i) => attempt({ topics: ["history"], confidence: 0.9, correct: i < 2 })),
			...Array.from({ length: 6 }, () => attempt({ topics: ["economy"], confidence: 0.9, correct: true })),
		];
		const focus = quizFocus(exam, as, NOW);
		assert.equal(focus[0]!.topic, "history");
		assert.match(focus[0]!.reason, /overconfident/);
		assert.equal(focus.find((f) => f.topic === "polity")!.reason, "not tested yet");
	});
});
