/**
 * The exam pipeline (src/agent/subagents/exam.ts) and the exam agent's
 * tools over isolated data and PYQ dirs: a paper is read into the bank
 * (cancelled questions and unusable keys dropped; re-reading is a no-op),
 * a quiz is generated with malformed questions dropped, a mock carries
 * held-out probes, and the tools refuse files outside the exam folder.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, type FauxResponseStep, type ToolCall } from "@earendil-works/pi-ai";
import type { ExamDefinition, PyqItem } from "../src/core/contracts/exam.ts";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-exam-pipeline-"));
process.env.LH_DATA_DIR = path.join(TMP, "data");
process.env.LH_PYQ_DIR = path.join(TMP, "PYQ");
fs.mkdirSync(path.join(TMP, "PYQ", "X"), { recursive: true });
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

/** A minimal valid one-page PDF (offsets computed, so pdfjs can parse it). */
function tinyPdf(file: string): void {
	const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>"];
	let out = "%PDF-1.4\n";
	const offsets: number[] = [];
	objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
	const xref = out.length;
	out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	fs.writeFileSync(file, out);
}
tinyPdf(path.join(TMP, "PYQ", "X", "paper-2024.pdf"));
tinyPdf(path.join(TMP, "PYQ", "X", "key-2024.pdf"));
tinyPdf(path.join(TMP, "PYQ", "X", "paper-2025.pdf"));

const { examStore } = await import("../src/store/exams.ts");
const { createExamPipeline, answerProblem } = await import("../src/agent/subagents/exam.ts");
const { examTools } = await import("../src/agent/tools/exam.ts");
const { composeInstructions } = await import("../src/agent/teacher-agent.ts");
const { examIdForChat, isHeldOut } = await import("../src/core/exam.ts");

const headless = { renderPdfPages: async (_f: string, pages: number[]) => pages.map((page) => ({ page, png: Buffer.from([137, 80, 78, 71]) })) } as never;
function scripted(steps: FauxResponseStep[]) {
	const faux = createFauxCore({});
	faux.setResponses(steps);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}
const submit = (name: string, input: unknown) => () => fauxAssistantMessage([fauxToolCall(name, input as ToolCall["arguments"])], { stopReason: "toolUse" });

const chatId = "chat_test1";
const examId = examIdForChat(chatId);
const exam: ExamDefinition = {
	id: examId, chatId, name: "Test exam", folder: "X", durationMin: 60, topics: ["polity", "history"], dailyGoal: 20, createdAt: "2026-10-27T00:00:00Z",
	sections: [{ name: "Main", questionCount: 20, types: ["mcq"], marks: { correct: 2, wrong: -0.5, unanswered: 0 } }],
};
const mcq = (over: Record<string, unknown> = {}) => ({ type: "mcq", question: "Which article?", options: ["14", "19", "21", "32"], topics: ["polity"], difficulty: 3, ...over });

describe("exam sessions", () => {
	it("are created with their kind, so the exam agent answers them", async () => {
		const { chatStore } = await import("../src/store/chats.ts");
		assert.equal(chatStore.createChat("Exam prep", "exam").kind, "exam");
		assert.equal(chatStore.createChat("Practice", "practice").kind, "practice");
		assert.equal(chatStore.createChat("Teach").kind, undefined, "teach stays absent");
	});
});

describe("answer checks", () => {
	it("accepts well-formed answers and names the problem otherwise", () => {
		assert.equal(answerProblem({ type: "mcq", options: ["a", "b", "c", "d"], answer: { choices: [2] } }), null);
		assert.match(answerProblem({ type: "mcq", options: ["a", "b", "c", "d"], answer: { choices: [4] } })!, /out of range/);
		assert.match(answerProblem({ type: "mcq", options: ["a", "b", "c"], answer: { choices: [0] } })!, /four options/);
		assert.match(answerProblem({ type: "numeric", answer: {} })!, /without a value/);
	});
});

describe("exam pipeline", () => {
	examStore.saveExam(exam);

	it("reads a paper into the bank once, dropping cancelled questions and unusable keys", async () => {
		const engine = scripted([submit("submit_pyqs", { series: "A", items: [
			{ ...mcq(), number: 1, answerChoices: [2] },
			{ ...mcq(), number: 2, cancelled: true },
			{ ...mcq(), number: 3, answerChoices: [9] },
			{ ...mcq({ topics: ["history"] }), number: 4, answerChoices: [0], questionAlt: "मराठी" },
		] })]);
		const pipeline = createExamPipeline({ examStore, engineFor: (role) => (role === "pyqExtractor" ? engine : undefined), headless });
		assert.equal(await pipeline.extractPaper(examId, { question: "paper-2024.pdf", key: "key-2024.pdf", year: 2024, label: "Prelim" }), 2);
		const bank = examStore.readPyqs(examId);
		assert.deepEqual(bank.map((p) => p.id), ["paper-2024-q1", "paper-2024-q4"]);
		assert.equal(bank[1]!.questionAlt, "मराठी");
		assert.deepEqual(bank[0]!.source, { file: "paper-2024.pdf" });
		assert.equal(await pipeline.extractPaper(examId, { question: "paper-2024.pdf", year: 2024, label: "Prelim" }), 0, "already read");
		await assert.rejects(pipeline.extractPaper(examId, { question: "../../etc/passwd", year: 2024, label: "x" }), /outside PYQ\/X/);
	});

	it("reports papers read to the session and keeps the extractor's notes", async () => {
		const engine = scripted([submit("submit_pyqs", { notes: "Q7's official key looks wrong", items: [{ ...mcq(), number: 7, answerChoices: [1] }] })]);
		const told: { examId: string; read: { file: string; items: number }[] }[] = [];
		const pipeline = createExamPipeline({ examStore, engineFor: () => engine, headless, onPapersRead: (examId, read) => told.push({ examId, read }) });
		pipeline.extractPapers(examId, [{ question: "paper-2025.pdf", year: 2025, label: "Prelim" }], (p, e) => assert.fail(`${p}: ${e}`));
		for (let i = 0; i < 100 && !told.length; i++) await new Promise((r) => setTimeout(r, 20));
		assert.deepEqual(told, [{ examId, read: [{ file: "paper-2025.pdf", items: 1 }] }]);
		assert.match(examStore.readExtractions(examId).find((e) => e.file === "paper-2025.pdf")!.notes!, /Q7's official key looks wrong/);
	});

	it("writes a quiz from the bank, dropping malformed questions", async () => {
		const extra = Array.from({ length: 30 }, (_, i) => ({ ...mcq(), id: `seed-${i}`, answer: { choices: [i % 4] }, year: 2020, paper: "Prelim", number: i + 1, source: { file: "seed.pdf" } }) as PyqItem);
		examStore.appendPyqs(examId, extra);
		const engine = scripted([submit("submit_questions", { questions: [
			{ ...mcq(), answer: { choices: [1] }, solution: "Article 19." },
			{ ...mcq({ options: ["a", "b"] }), answer: { choices: [0] }, solution: "bad: two options" },
			{ type: "numeric", question: "Seats?", answer: { value: 288 }, solution: "288 seats.", topics: ["polity"], difficulty: 4 },
		] })]);
		const pipeline = createExamPipeline({ examStore, engineFor: (role) => (role === "testGenerator" ? engine : undefined), headless });
		const test = pipeline.startTest(examId, "quiz", { questions: 5, minutes: 10 });
		assert.equal(test.status, "generating");
		assert.equal(test.durationSec, 600);
		for (let i = 0; i < 50 && examStore.getTest(examId, test.id)!.status === "generating"; i++) await new Promise((r) => setTimeout(r, 20));
		const ready = examStore.getTest(examId, test.id)!;
		assert.equal(ready.status, "ready", ready.error);
		assert.equal(ready.questions.length, 2, "the two-option MCQ was dropped");
		assert.ok(ready.questions.every((q) => q.origin === "generated" && q.solution));
	});

	it("puts unseen held-out PYQs into a mock as probes", async () => {
		const held = examStore.readPyqs(examId).filter((p) => isHeldOut(p.id));
		assert.ok(held.length > 0, "the seed bank has held-out items");
		const engine = scripted(Array.from({ length: 5 }, () => submit("submit_questions", { questions: Array.from({ length: 10 }, () => ({ ...mcq(), answer: { choices: [1] }, solution: "s" })) })));
		const pipeline = createExamPipeline({ examStore, engineFor: () => engine, headless });
		const test = pipeline.startTest(examId, "mock");
		for (let i = 0; i < 50 && examStore.getTest(examId, test.id)!.status === "generating"; i++) await new Promise((r) => setTimeout(r, 20));
		const ready = examStore.getTest(examId, test.id)!;
		assert.equal(ready.status, "ready", ready.error);
		assert.equal(ready.durationSec, 3600);
		const probes = ready.questions.filter((q) => q.probe);
		assert.equal(probes.length, Math.min(3, held.length));
		assert.ok(probes.every((p) => p.pyqId && isHeldOut(p.pyqId) && p.id !== p.pyqId));
		assert.equal(ready.questions.length, 20);
	});

	it("exposes the exam tools with folder checks, and composes the exam prompt", async () => {
		const tools = examTools({ chatId, examStore, pipeline: createExamPipeline({ examStore, engineFor: () => undefined, headless }) });
		const call = async (name: string, args: unknown) => {
			const r = await tools[name]!.execute("c1", args).then((x) => x, (e: Error) => e);
			return r instanceof Error ? r.message : r.content.map((c) => ("text" in c ? c.text : "")).join("");
		};
		assert.match(await call("exam_define", { ...exam, folder: "Nope" }), /There is no folder PYQ\/Nope/);
		assert.match(await call("exam_define", { name: exam.name, folder: "X", durationMin: 60, sections: exam.sections, topics: exam.topics }), new RegExp(`Dashboard: /exam/${examId}`));
		assert.match(await call("exam_extract_pyqs", { papers: [{ question: "missing.pdf", year: 2024, label: "Prelim" }] }), /Not in PYQ\/X\/: missing\.pdf/);
		assert.match(await call("exam_status", {}), /paper-2024\.pdf \(read: 2 questions\)/);
		assert.match(await call("exam_status", {}), /Extraction notes[\s\S]*Q7's official key looks wrong/);
		assert.match(composeInstructions("exam"), /# Exam preparation/);
	});
});
