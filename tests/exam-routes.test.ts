/**
 * The exam routes (app/api/exams/*) over an isolated data dir: answers stay
 * hidden until submission, autosave validates input and the server-owned
 * deadline, submission grades once, records attempts and notifies the
 * exam session's listener.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import type { ExamDefinition, TestRecord } from "../src/core/contracts/exam.ts";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-exam-"));
process.env.LH_DATA_DIR = TMP_DATA;
const { examStore } = await import("../src/store/exams.ts");
const { onTestSubmitted } = await import("../src/server/exams.ts");
const testRoute = await import("../app/api/exams/[id]/tests/[testId]/route.ts");
const responses = await import("../app/api/exams/[id]/tests/[testId]/responses/route.ts");
const start = await import("../app/api/exams/[id]/tests/[testId]/start/route.ts");
const submit = await import("../app/api/exams/[id]/tests/[testId]/submit/route.ts");
const dashboard = await import("../app/api/exams/[id]/route.ts");
after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

const exam: ExamDefinition = {
	id: "cgl", name: "CGL", folder: "CGL", durationMin: 60, topics: ["polity"], dailyGoal: 20, chatId: "chat_x", createdAt: "2026-10-27T00:00:00Z",
	sections: [{ name: "Main", questionCount: 100, types: ["mcq"], marks: { correct: 2, wrong: -0.5, unanswered: 0 } }],
};
const newTest = (id: string, over: Partial<TestRecord> = {}): TestRecord => ({
	id, examId: "cgl", kind: "quiz", status: "ready", createdAt: "2026-10-27T00:00:00Z", durationSec: 600, responses: {},
	questions: [
		{ id: "q1", type: "mcq", question: "Article 21 protects?", options: ["Life", "Trade", "Speech", "Religion"], answer: { choices: [0] }, solution: "Article 21: life and personal liberty.", topics: ["polity"], difficulty: 3, origin: "generated" },
		{ id: "q2", type: "mcq", question: "The 73rd amendment concerns?", options: ["Municipalities", "Panchayats", "GST", "Elections"], answer: { choices: [1] }, topics: ["polity"], difficulty: 3, origin: "pyq", pyqId: "p1", probe: true },
	],
	...over,
});
const params = (testId: string) => ({ params: Promise.resolve({ id: "cgl", testId }) });
const put = (testId: string, body: unknown) => responses.PUT(new Request("http://t", { method: "PUT", body: JSON.stringify(body) }), params(testId));

describe("exam routes", () => {
	examStore.saveExam(exam);

	it("hides answers, solutions and probes until submission", async () => {
		examStore.saveTest(newTest("t1"));
		const view = await (await testRoute.GET(new Request("http://t/x"), params("t1"))).json();
		assert.equal(view.secondsLeft, 600);
		assert.deepEqual(view.test.questions[0].answer, {});
		assert.equal(view.test.questions[0].solution, undefined);
		assert.equal(view.test.questions[1].probe, undefined);
		assert.equal((await testRoute.GET(new Request("http://t/x?result=1"), params("t1"))).status, 409, "no result before submitting");
	});

	it("validates autosaves and starts the clock on the first one", async () => {
		assert.equal((await put("t1", { questionId: "q1", response: { choices: [7] } })).status, 400, "option index out of range");
		assert.equal((await put("t1", { questionId: "q1", response: { choices: [0], confidence: 0.6 } })).status, 400, "confidence off the scale");
		assert.equal((await put("t1", { questionId: "nope", response: {} })).status, 400);
		const ok = await put("t1", { questionId: "q1", response: { choices: [0], confidence: 0.9, timeSec: 12 } });
		assert.equal(ok.status, 200);
		assert.ok(examStore.getTest("cgl", "t1")!.startedAt, "the first save started the clock");
	});

	it("refuses saves after the deadline", async () => {
		examStore.saveTest(newTest("t2", { startedAt: new Date(Date.now() - 700_000).toISOString() }));
		assert.equal((await put("t2", { questionId: "q1", response: { choices: [0] } })).status, 409);
		assert.equal((await start.POST(new Request("http://t", { method: "POST" }), params("t2"))).status, 200, "start is idempotent");
	});

	it("grades once, records attempts, and tells the exam session", async () => {
		const seen: string[] = [];
		const stop = onTestSubmitted((_e, t, score) => seen.push(`${t.id}:${score.score}`));
		await put("t1", { questionId: "q2", response: { choices: [3], confidence: 1, timeSec: 20 } });
		const res = await (await submit.POST(new Request("http://t", { method: "POST" }), params("t1"))).json();
		assert.deepEqual(res.score, { score: 1.5, max: 4, correct: 1, wrong: 1, unanswered: 0 });
		assert.equal(res.test.questions[0].solution, "Article 21: life and personal liberty.", "solutions after submission");
		await submit.POST(new Request("http://t", { method: "POST" }), params("t1"));
		stop();
		const attempts = examStore.readAttempts("cgl");
		assert.equal(attempts.length, 2, "a second submit adds nothing");
		assert.deepEqual(attempts.map((a) => [a.questionId, a.correct, a.probe ?? false]), [["q1", true, false], ["q2", false, true]]);
		assert.deepEqual(seen, ["t1:1.5"]);
		assert.equal((await put("t1", { questionId: "q1", response: { choices: [1] } })).status, 409, "a submitted test is closed");

		const dash = await (await dashboard.GET(new Request("http://t"), { params: Promise.resolve({ id: "cgl" }) })).json();
		assert.equal(dash.summary.daily.today, 2);
		assert.equal(dash.tests.find((t: { id: string }) => t.id === "t1").score.score, 1.5);
	});
});
