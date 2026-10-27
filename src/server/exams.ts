import { nanoid } from "nanoid";
import { CONFIDENCE_LEVELS, type ExamDefinition, type TestRecord, type TestResponse } from "../core/contracts/exam.ts";
import { attemptsOf, examSummary, isHeldOut, publicTest, scoreTest, secondsLeft, type ExamSummary, type TestScore } from "../core/exam.ts";
import { stores } from "./stores.ts";

/**
 * The exam-prep service (docs/agent-driver-plan.md §6b) behind the
 * /api/exams routes: dashboard, the test page's view and autosave, and
 * submission. The server's clock owns the timer.
 */

export class ExamError extends Error {
	constructor(message: string, readonly status: number) { super(message); }
}

/** Saves this long after the deadline still land (network latency at zero). */
const GRACE_SEC = 30;

function examOrThrow(id: string): ExamDefinition {
	const exam = stores.examStore.getExam(id);
	if (!exam) throw new ExamError("Unknown exam", 404);
	return exam;
}

function testOrThrow(examId: string, testId: string): TestRecord {
	const test = stores.examStore.getTest(examId, testId);
	if (!test) throw new ExamError("Unknown test", 404);
	return test;
}

export interface ExamDashboard {
	exam: ExamDefinition;
	summary: ExamSummary;
	bank: { items: number; heldOut: number; papers: number };
	tests: { id: string; kind: TestRecord["kind"]; status: TestRecord["status"]; createdAt: string; questions: number; score?: TestScore }[];
}

export function examDashboard(id: string, now = Date.now()): ExamDashboard {
	const exam = examOrThrow(id);
	const pyqs = stores.examStore.readPyqs(id);
	return {
		exam,
		summary: examSummary(exam, stores.examStore.readAttempts(id), now),
		bank: { items: pyqs.length, heldOut: pyqs.filter((p) => isHeldOut(p.id)).length, papers: stores.examStore.readExtractions(id).length },
		tests: stores.examStore.listTests(id).map((t) => ({
			id: t.id, kind: t.kind, status: t.status, createdAt: t.createdAt, questions: t.questions.length,
			...(t.status === "submitted" ? { score: scoreTest(t, exam) } : {}),
		})),
	};
}

export function setDailyGoal(id: string, goal: unknown): ExamDefinition {
	const exam = examOrThrow(id);
	if (typeof goal !== "number" || !Number.isInteger(goal) || goal < 1 || goal > 500) throw new ExamError("dailyGoal must be a whole number from 1 to 500", 400);
	const next = { ...exam, dailyGoal: goal };
	stores.examStore.saveExam(next);
	return next;
}

export function testView(examId: string, testId: string, now = Date.now()): { exam: ExamDefinition; test: TestRecord; secondsLeft: number } {
	const exam = examOrThrow(examId);
	const test = testOrThrow(examId, testId);
	return { exam, test: publicTest(test), secondsLeft: secondsLeft(test, now) };
}

export function startTest(examId: string, testId: string, now = Date.now()): ReturnType<typeof testView> {
	const test = testOrThrow(examId, testId);
	if (test.status !== "ready") throw new ExamError(`The test is ${test.status}`, 409);
	if (!test.startedAt) stores.examStore.saveTest({ ...test, startedAt: new Date(now).toISOString() });
	return testView(examId, testId, now);
}

function parseResponse(raw: unknown, optionCount: number): TestResponse {
	if (typeof raw !== "object" || raw === null) throw new ExamError("response must be an object", 400);
	const r = raw as Record<string, unknown>;
	const out: TestResponse = { timeSec: typeof r.timeSec === "number" && r.timeSec >= 0 && Number.isFinite(r.timeSec) ? r.timeSec : 0 };
	if (r.choices !== undefined) {
		if (!Array.isArray(r.choices) || !r.choices.every((c) => Number.isInteger(c) && c >= 0 && c < optionCount)) throw new ExamError("choices must be option indexes", 400);
		out.choices = [...new Set(r.choices as number[])];
	}
	if (r.value !== undefined && r.value !== null) {
		if (typeof r.value !== "number" || !Number.isFinite(r.value)) throw new ExamError("value must be a number", 400);
		out.value = r.value;
	}
	if (r.confidence !== undefined) {
		if (!(CONFIDENCE_LEVELS as readonly unknown[]).includes(r.confidence)) throw new ExamError(`confidence must be one of ${CONFIDENCE_LEVELS.join(", ")}`, 400);
		out.confidence = r.confidence as number;
	}
	if (typeof r.markedForReview === "boolean") out.markedForReview = r.markedForReview;
	if (typeof r.visited === "boolean") out.visited = r.visited;
	return out;
}

/** Autosave one answer; the first save also starts the clock. */
export function saveResponse(examId: string, testId: string, questionId: unknown, raw: unknown, now = Date.now()): { secondsLeft: number } {
	const test = testOrThrow(examId, testId);
	if (test.status !== "ready") throw new ExamError(`The test is ${test.status}`, 409);
	const question = test.questions.find((q) => q.id === questionId);
	if (!question) throw new ExamError("Unknown question", 400);
	const started = test.startedAt ?? new Date(now).toISOString();
	if (secondsLeft({ ...test, startedAt: started }, now - GRACE_SEC * 1000) <= 0) throw new ExamError("Time is up", 409);
	const response = parseResponse(raw, question.options?.length ?? 0);
	stores.examStore.saveTest({ ...test, startedAt: started, responses: { ...test.responses, [question.id]: response } });
	return { secondsLeft: secondsLeft({ ...test, startedAt: started }, now) };
}

export interface TestResult {
	exam: ExamDefinition;
	test: TestRecord;
	score: TestScore;
	summary: ExamSummary;
}

type SubmitListener = (exam: ExamDefinition, test: TestRecord, score: TestScore) => void;
const listeners = (globalThis as { __lhExamSubmit?: Set<SubmitListener> }).__lhExamSubmit ??= new Set();
/** The exam agent's debrief hook (chat-handler registers it). */
export function onTestSubmitted(listener: SubmitListener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Grade, record attempts, and hand the result to the exam session. Idempotent. */
export function submitTest(examId: string, testId: string, now = Date.now()): TestResult {
	const exam = examOrThrow(examId);
	const test = testOrThrow(examId, testId);
	if (test.status === "submitted") return testResult(examId, testId, now);
	if (test.status !== "ready") throw new ExamError(`The test is ${test.status}`, 409);
	const at = new Date(now).toISOString();
	const submitted: TestRecord = { ...test, status: "submitted", startedAt: test.startedAt ?? at, submittedAt: at };
	stores.examStore.saveTest(submitted);
	stores.examStore.appendAttempts(examId, attemptsOf(submitted, at, () => `at_${nanoid(10)}`));
	const score = scoreTest(submitted, exam);
	for (const listener of listeners) {
		try { listener(exam, submitted, score); } catch (err) { console.error(`[exam ${examId}] submit listener failed:`, err); }
	}
	return testResult(examId, testId, now);
}

export function testResult(examId: string, testId: string, now = Date.now()): TestResult {
	const exam = examOrThrow(examId);
	const test = testOrThrow(examId, testId);
	if (test.status !== "submitted") throw new ExamError("Submit the test first", 409);
	return { exam, test, score: scoreTest(test, exam), summary: examSummary(exam, stores.examStore.readAttempts(examId), now) };
}
