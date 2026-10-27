import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import type { Attempt, ExamDefinition, PyqItem, TestRecord } from "../core/contracts/exam.ts";
import type { ExamStore } from "../core/ports.ts";

/** The fs adapter for exam prep (core/ports.ts ExamStore): whole-file JSON
 *  for the exam and each test, append-only JSONL for the PYQ bank, the
 *  extraction log and attempts (the graph ledgers' idiom). */

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
function dir(examId: string): string {
	if (!SAFE_ID.test(examId)) throw new Error(`Invalid exam id: ${examId}`);
	return path.join(PATHS.exams, examId);
}

function readJson<T>(file: string): T | null {
	try { return JSON.parse(fs.readFileSync(file, "utf-8")) as T; } catch { return null; }
}

function writeJson(file: string, value: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(value, null, "\t"), "utf-8");
	fs.renameSync(tmp, file); // a crash mid-write must not leave a half test behind
}

function readLines<T>(file: string, valid: (v: unknown) => v is T): T[] {
	let raw: string;
	try { raw = fs.readFileSync(file, "utf-8"); } catch { return []; }
	return raw.split("\n").flatMap((line) => {
		if (!line.trim()) return [];
		try { const v: unknown = JSON.parse(line); return valid(v) ? [v] : []; } catch { return []; }
	});
}

function appendLines(file: string, records: readonly unknown[]): void {
	if (!records.length) return;
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.appendFileSync(file, records.map((r) => `${JSON.stringify(r)}\n`).join(""), "utf-8");
}

const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPyq = (v: unknown): v is PyqItem => obj(v) && typeof v.id === "string" && typeof v.question === "string" && obj(v.answer) && Array.isArray(v.topics) && obj(v.source);
const isAttempt = (v: unknown): v is Attempt => obj(v) && typeof v.id === "string" && typeof v.questionId === "string" && typeof v.at === "string" && Array.isArray(v.topics) && (v.correct === null || typeof v.correct === "boolean");
const isExtraction = (v: unknown): v is { file: string; items: number; at: string; notes?: string } => obj(v) && typeof v.file === "string" && typeof v.items === "number";

export const examStore: ExamStore = {
	listExams() {
		let ids: string[];
		try { ids = fs.readdirSync(PATHS.exams).filter((d) => SAFE_ID.test(d)); } catch { return []; }
		return ids.flatMap((id) => { const e = readJson<ExamDefinition>(path.join(PATHS.exams, id, "exam.json")); return e ? [e] : []; });
	},
	getExam: (id) => (SAFE_ID.test(id) ? readJson<ExamDefinition>(path.join(dir(id), "exam.json")) : null),
	saveExam: (exam) => writeJson(path.join(dir(exam.id), "exam.json"), exam),
	readPyqs: (examId) => readLines(path.join(dir(examId), "pyq.jsonl"), isPyq),
	appendPyqs: (examId, items) => appendLines(path.join(dir(examId), "pyq.jsonl"), items),
	readExtractions: (examId) => readLines(path.join(dir(examId), "extractions.jsonl"), isExtraction),
	recordExtraction: (examId, entry) => appendLines(path.join(dir(examId), "extractions.jsonl"), [entry]),
	listTests(examId) {
		let files: string[];
		try { files = fs.readdirSync(path.join(dir(examId), "tests")).filter((f) => f.endsWith(".json")); } catch { return []; }
		return files.flatMap((f) => { const t = readJson<TestRecord>(path.join(dir(examId), "tests", f)); return t ? [t] : []; })
			.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	},
	getTest: (examId, testId) => (SAFE_ID.test(examId) && SAFE_ID.test(testId) ? readJson<TestRecord>(path.join(dir(examId), "tests", `${testId}.json`)) : null),
	saveTest(test) {
		if (!SAFE_ID.test(test.id)) throw new Error(`Invalid test id: ${test.id}`);
		writeJson(path.join(dir(test.examId), "tests", `${test.id}.json`), test);
	},
	readAttempts: (examId) => readLines(path.join(dir(examId), "attempts.jsonl"), isAttempt),
	appendAttempts: (examId, attempts) => appendLines(path.join(dir(examId), "attempts.jsonl"), attempts),
};
