import * as fs from "node:fs";
import * as path from "node:path";
import { normalizeContext, type AssistantMessage, type ImageContent, type Message, type TextContent, type Tool, type ToolCall } from "@earendil-works/pi-ai";
import { Value } from "typebox/value";
import { Type, type Static } from "typebox";
import { nanoid } from "nanoid";
import { PATHS, type ModelRole } from "../../../config.ts";
import type { Attempt, ExamDefinition, ExamQuestion, PyqItem, TestKind, TestQuestion, TestRecord } from "../../core/contracts/exam.ts";
import { dueRetests, isHeldOut, quizFocus } from "../../core/exam.ts";
import type { ExamStore } from "../../core/ports.ts";
import type { PiEngine } from "../models.ts";
import { getHeadless, type HeadlessApi } from "./headless.ts";
import { pdfInfo } from "./pdf-ops.ts";

/**
 * THE EXAM PIPELINE (docs/agent-driver-plan.md §6b): reads past papers
 * (scans, by rendering pages for a vision-capable model) into the PYQ bank,
 * and writes new tests at or above PYQ level, weighted by the learner's
 * attempts. Both run in the background; the exam store is the only output.
 */

const ROLES_DIR = path.join(PATHS.root, "src", "agent", "prompts", "roles");
const rolePrompt = (name: string) => fs.readFileSync(path.join(ROLES_DIR, `${name}.md`), "utf-8");
const PAGES_PER_CHUNK = 3;
const QUESTIONS_PER_BATCH = 10;
const TRIES = 3;

export interface ExamPipelineDeps {
	examStore: ExamStore;
	engineFor: (role: ModelRole) => PiEngine | undefined;
	headless?: HeadlessApi;
	/** A batch of papers finished reading (the exam session is told, to offer a quiz). */
	onPapersRead?: (examId: string, read: { file: string; items: number }[]) => void;
}

/** A material file inside the exam's PYQ folder — never outside it. */
export function materialPath(exam: ExamDefinition, file: string): string {
	const root = path.resolve(PATHS.pyq, exam.folder);
	const full = path.resolve(root, file);
	if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`${file} is outside PYQ/${exam.folder}/`);
	if (!fs.existsSync(full)) throw new Error(`PYQ/${exam.folder}/${file} does not exist`);
	return full;
}

/** One model call with a single submit tool; returns the validated input or
 *  the problem to send back. Retries on a missing or invalid submission. */
export async function submitOnce<T>(engine: PiEngine, system: string, content: (TextContent | ImageContent)[], tool: Tool, signal?: AbortSignal): Promise<T> {
	let messages: Message[] = [{ role: "user", content, timestamp: Date.now() }];
	for (let attempt = 0; attempt < TRIES; attempt++) {
		const reply: AssistantMessage = await engine.streamFn(engine.model, normalizeContext({ systemPrompt: system, messages, tools: [tool] }), { signal } as never).result();
		if (reply.stopReason === "error" || reply.stopReason === "aborted") throw new Error(reply.errorMessage ?? `model call ${reply.stopReason}`);
		const call = reply.content.find((c): c is ToolCall => c.type === "toolCall" && c.name === tool.name);
		const problem = !call ? `Call ${tool.name} with your result.` : Value.Check(tool.parameters, call.arguments) ? null : `Invalid ${tool.name} arguments: ${[...Value.Errors(tool.parameters, call.arguments)].slice(0, 5).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ")}`;
		if (!problem && call) return call.arguments as T;
		messages = [...messages, reply, ...(call
			? [{ role: "toolResult" as const, toolCallId: call.id, toolName: call.name, content: [{ type: "text" as const, text: problem! }], isError: true, timestamp: Date.now() }]
			: [{ role: "user" as const, content: problem!, timestamp: Date.now() }])];
	}
	throw new Error(`no valid ${tool.name} after ${TRIES} tries`);
}

const questionType = Type.Union([Type.Literal("mcq"), Type.Literal("msq"), Type.Literal("numeric")]);

const pyqTool = {
	name: "submit_pyqs",
	description: "Submit the questions transcribed from these pages (an empty list if none are complete here).",
	parameters: Type.Object({
		series: Type.Optional(Type.String({ description: "The booklet series of this paper, as printed." })),
		notes: Type.Optional(Type.String()),
		items: Type.Array(Type.Object({
			number: Type.Integer({ minimum: 1 }),
			type: questionType,
			question: Type.String({ minLength: 1 }),
			questionAlt: Type.Optional(Type.String()),
			options: Type.Optional(Type.Array(Type.String())),
			optionsAlt: Type.Optional(Type.Array(Type.String())),
			cancelled: Type.Optional(Type.Boolean()),
			answerChoices: Type.Optional(Type.Array(Type.Integer({ minimum: 0 }))),
			answerValue: Type.Optional(Type.Number()),
			topics: Type.Array(Type.String(), { minItems: 1 }),
			difficulty: Type.Integer({ minimum: 1, maximum: 5 }),
			section: Type.Optional(Type.String()),
			page: Type.Optional(Type.Integer({ minimum: 1 })),
		})),
	}),
} satisfies Tool;
type PyqSubmission = Static<typeof pyqTool.parameters>;

const questionSchema = Type.Object({
	type: questionType,
	question: Type.String({ minLength: 1 }),
	questionAlt: Type.Optional(Type.String()),
	options: Type.Optional(Type.Array(Type.String())),
	optionsAlt: Type.Optional(Type.Array(Type.String())),
	answer: Type.Object({ choices: Type.Optional(Type.Array(Type.Integer({ minimum: 0 }))), value: Type.Optional(Type.Number()), tolerance: Type.Optional(Type.Number({ minimum: 0 })) }),
	solution: Type.String({ minLength: 1 }),
	topics: Type.Array(Type.String(), { minItems: 1 }),
	difficulty: Type.Integer({ minimum: 1, maximum: 5 }),
	section: Type.Optional(Type.String()),
	retestOf: Type.Optional(Type.String()),
});
const generateTool = {
	name: "submit_questions",
	description: "Submit the new questions, each solved, with its worked solution.",
	parameters: Type.Object({ questions: Type.Array(questionSchema) }),
} satisfies Tool;
type GeneratedQuestion = Static<typeof questionSchema>;
type FocusSlot = { topic: string; weight: number; reason: string };

const slug = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/** Whether a question's answer is well-formed for its type and options. */
export function answerProblem(q: Pick<ExamQuestion, "type" | "options" | "answer">): string | null {
	if (q.type === "numeric") return typeof q.answer.value === "number" ? null : "numeric question without a value";
	const n = q.options?.length ?? 0;
	if (n < 2) return "choice question without options";
	const choices = q.answer.choices ?? [];
	if (!choices.length || choices.some((c) => c >= n)) return "answer choices out of range";
	if (q.type === "mcq" && n !== 4) return "an MCQ needs exactly four options";
	return null;
}

const describe = (q: ExamQuestion) => {
	const opts = q.options?.map((o, i) => `  ${i + 1}. ${o}`).join("\n") ?? "";
	const ans = q.type === "numeric" ? String(q.answer.value) : (q.answer.choices ?? []).map((c) => c + 1).join(", ");
	return `${q.question}\n${opts}\nAnswer: ${ans}`;
};

export function createExamPipeline(deps: ExamPipelineDeps) {
	const running = new Set<string>();
	const headless = () => deps.headless ?? getHeadless();

	/** Read one paper (and its key) into the bank. Idempotent per file. */
	async function extractPaper(examId: string, paper: { question: string; key?: string; year: number; label: string }, signal?: AbortSignal): Promise<number> {
		const exam = deps.examStore.getExam(examId);
		if (!exam) throw new Error("Unknown exam");
		if (deps.examStore.readExtractions(examId).some((e) => e.file === paper.question)) return 0;
		const engine = deps.engineFor("pyqExtractor");
		if (!engine) throw new Error("No model is set for reading papers (vision slot).");
		const questionPdf = materialPath(exam, paper.question);
		const keyPdf = paper.key ? materialPath(exam, paper.key) : undefined;
		const pages = (await pdfInfo(questionPdf)).page_count;
		// Key images only: pdfjs runs the key's table columns together, so its text misled more than it helped (live run 2026-10-27).
		// shortcut: keys beyond 3 pages are cut off; render more if a paper's key is longer.
		const keyImages = keyPdf ? (await headless().renderPdfPages(keyPdf, [1, 2, 3].slice(0, Math.min(3, (await pdfInfo(keyPdf)).page_count)), { dpi: 120 })) : [];
		const existing = new Set(deps.examStore.readPyqs(examId).map((p) => p.id));
		const base = slug(paper.question);
		let added = 0;
		const notes: string[] = [];
		for (let from = 1; from <= pages; from += PAGES_PER_CHUNK) {
			const wanted = Array.from({ length: Math.min(PAGES_PER_CHUNK, pages - from + 1) }, (_, i) => from + i);
			const rendered = await headless().renderPdfPages(questionPdf, wanted, { dpi: 150 });
			const content: (TextContent | ImageContent)[] = [
				{ type: "text", text: [
					`Exam: ${exam.name}. Paper: ${paper.label}, ${paper.year} (${paper.question}).`,
					`Syllabus topics: ${exam.topics.join("; ")}.`,
					`Pages ${wanted[0]}–${wanted[wanted.length - 1]} of ${pages} follow, then the answer key.`,
					keyPdf ? `The answer key (${paper.key}) is the last ${keyImages.length} image(s).` : "No answer key was supplied: leave answers out and say so in notes.",
				].join("\n\n") },
				...rendered.map((p) => ({ type: "image" as const, data: p.png.toString("base64"), mimeType: "image/png" })),
				...keyImages.map((p) => ({ type: "image" as const, data: p.png.toString("base64"), mimeType: "image/png" })),
			];
			const out = await submitOnce<PyqSubmission>(engine, rolePrompt("pyq_extractor"), content, pyqTool, signal);
			if (out.notes?.trim()) notes.push(`p${wanted[0]}–${wanted[wanted.length - 1]}: ${out.notes.trim()}`);
			const items: PyqItem[] = out.items.flatMap((it): PyqItem[] => {
				const id = `${base}-q${it.number}`;
				if (it.cancelled || existing.has(id)) return [];
				const item: PyqItem = {
					id, type: it.type, question: it.question, ...(it.questionAlt ? { questionAlt: it.questionAlt } : {}),
					...(it.options ? { options: it.options } : {}), ...(it.optionsAlt ? { optionsAlt: it.optionsAlt } : {}),
					answer: it.type === "numeric" ? { value: it.answerValue } : { choices: it.answerChoices ?? [] },
					topics: it.topics, difficulty: it.difficulty, ...(it.section ? { section: it.section } : {}),
					year: paper.year, paper: paper.label, number: it.number,
					source: { file: paper.question, ...(it.page ? { page: it.page } : {}) },
				};
				return answerProblem(item) ? [] : [item]; // no trustworthy key → not in the bank
			});
			items.forEach((i) => existing.add(i.id));
			deps.examStore.appendPyqs(examId, items);
			added += items.length;
		}
		deps.examStore.recordExtraction(examId, { file: paper.question, items: added, at: new Date().toISOString(), ...(notes.length ? { notes: notes.join("\n") } : {}) });
		return added;
	}

	/** Papers run one after another, in the background. */
	function extractPapers(examId: string, papers: Parameters<typeof extractPaper>[1][], onError: (paper: string, err: unknown) => void): void {
		const key = `extract:${examId}`;
		if (running.has(key)) return;
		running.add(key);
		void (async () => {
			const read: { file: string; items: number }[] = [];
			try {
				for (const p of papers) {
					try { read.push({ file: p.question, items: await extractPaper(examId, p) }); } catch (err) { onError(p.question, err); }
				}
			} finally {
				running.delete(key);
				if (read.some((r) => r.items > 0)) deps.onPapersRead?.(examId, read);
			}
		})();
	}

	function questionsFor(exam: ExamDefinition, kind: TestKind, requested?: number): number {
		const total = exam.sections.reduce((s, x) => s + x.questionCount, 0) || 20;
		return kind === "mock" ? total : Math.min(Math.max(requested ?? 15, 5), 30);
	}

	/** Create a test record in "generating" state; generation runs in the background. */
	function startTest(examId: string, kind: TestKind, opts: { questions?: number; minutes?: number } = {}, onError: (err: unknown) => void = () => {}): TestRecord {
		const exam = deps.examStore.getExam(examId);
		if (!exam) throw new Error("Unknown exam");
		const total = exam.sections.reduce((s, x) => s + x.questionCount, 0) || 20;
		const n = questionsFor(exam, kind, opts.questions);
		const durationSec = kind === "mock" ? exam.durationMin * 60 : Math.round((opts.minutes ?? (exam.durationMin * n) / total) * 60);
		const test: TestRecord = { id: `t_${nanoid(10)}`, examId, kind, status: "generating", createdAt: new Date().toISOString(), durationSec, questions: [], responses: {} };
		deps.examStore.saveTest(test);
		void generate(exam, test, n).catch((err) => {
			deps.examStore.saveTest({ ...test, status: "failed", error: err instanceof Error ? err.message : String(err) });
			onError(err);
		});
		return test;
	}

	async function generate(exam: ExamDefinition, test: TestRecord, n: number, signal?: AbortSignal): Promise<void> {
		const engine = deps.engineFor("testGenerator");
		if (!engine) throw new Error("No model is set for writing tests (strong slot).");
		const attempts: Attempt[] = deps.examStore.readAttempts(exam.id);
		const bank = deps.examStore.readPyqs(exam.id);
		const visible = bank.filter((p) => !isHeldOut(p.id));
		if (visible.length < 5) throw new Error("The PYQ bank has fewer than 5 questions; extract papers first.");
		const focus = quizFocus(exam, attempts).filter((f) => visible.some((p) => p.topics.includes(f.topic)));
		const weights = test.kind === "mock"
			? exam.topics.map((topic) => ({ topic, weight: visible.filter((p) => p.topics.includes(topic)).length, reason: "share of past papers" })).filter((f) => f.weight > 0)
			: focus;
		const sum = weights.reduce((s, f) => s + f.weight, 0) || 1;
		const probes: TestQuestion[] = test.kind === "mock"
			? bank.filter((p) => isHeldOut(p.id) && !attempts.some((a) => a.pyqId === p.id)).slice(0, 3)
				.map(({ year: _y, paper: _p, number: _n, source: _s, ...q }) => ({ ...q, id: `q_${nanoid(8)}`, origin: "pyq" as const, pyqId: q.id, probe: true }))
			: [];
		const retests = test.kind === "quiz" ? dueRetests(attempts).slice(0, Math.floor(n / 4)) : [];
		const target = n - probes.length;
		// One quota slot per question: proportional counts, padded by cycling the weighted topics so it always fills.
		const counted = weights.flatMap((f) => Array<FocusSlot>(Math.max(1, Math.round((target * f.weight) / sum))).fill(f));
		const quota = Array.from({ length: target }, (_, i) => counted[i] ?? counted[i % Math.max(1, counted.length)]!);
		const questions: GeneratedQuestion[] = [];
		for (let start = 0; questions.length < target && start < target * 2; start += QUESTIONS_PER_BATCH) {
			const want = Math.min(QUESTIONS_PER_BATCH, target - questions.length);
			const topics = quota.slice(questions.length, questions.length + want);
			const topicNames = [...new Set(topics.map((t) => t.topic))];
			const exemplars = topicNames.flatMap((t) => visible.filter((p) => p.topics.includes(t)).sort((a, b) => b.difficulty - a.difficulty).slice(0, 2));
			const retestHere = retests.splice(0, Math.max(0, Math.floor(want / 4)));
			const previous = retestHere.flatMap((a) => deps.examStore.getTest(exam.id, a.testId)?.questions.find((q) => q.id === a.questionId) ?? []);
			const prompt = [
				`Exam: ${exam.name}. Pattern: ${exam.sections.map((s) => `${s.name}: ${s.questionCount} × ${s.types.join("/")}, +${s.marks.correct}/${s.marks.wrong}`).join("; ")}.`,
				`Write ${want} new questions. Topic quota for this batch: ${topicNames.map((t) => `${t} × ${topics.filter((x) => x.topic === t).length} (${topics.find((x) => x.topic === t)!.reason})`).join("; ")}.`,
				`Level reference: real past-paper questions for these topics (do not copy; match or exceed their level):\n\n${exemplars.map((p) => `[${p.year} ${p.paper} Q${p.number}, difficulty ${p.difficulty}]\n${describe(p)}`).join("\n\n")}`,
				previous.length ? `Retests: the learner missed these; for each, write one fresh-surface question on the same idea and set retestOf to its id:\n\n${previous.map((q) => `[${q.id}]\n${describe(q)}`).join("\n\n")}` : "",
				questions.length ? `Already written for this test (avoid overlap): ${questions.map((q) => q.question.slice(0, 80)).join(" | ")}` : "",
			].filter(Boolean).join("\n\n");
			const out = await submitOnce<{ questions: GeneratedQuestion[] }>(engine, rolePrompt("test_generator"), [{ type: "text", text: prompt }], generateTool, signal);
			questions.push(...out.questions.filter((q) => !answerProblem(q)).slice(0, want));
		}
		if (!questions.length) throw new Error("The generator produced no usable questions.");
		const generated: TestQuestion[] = questions.map((q) => ({ ...q, id: `q_${nanoid(8)}`, origin: "generated" as const }));
		const all = [...generated];
		for (const p of probes) all.splice(Math.floor(Math.random() * (all.length + 1)), 0, p);
		deps.examStore.saveTest({ ...test, status: "ready", questions: all, focus: weights.slice(0, 5).map(({ topic, reason }) => ({ topic, reason })) });
	}

	return { extractPaper, extractPapers, startTest };
}

export type ExamPipeline = ReturnType<typeof createExamPipeline>;
