import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { PATHS } from "../../../config.ts";
import type { ExamDefinition } from "../../core/contracts/exam.ts";
import { examIdForChat, examSummary, isHeldOut, scoreTest } from "../../core/exam.ts";
import type { ExamStore } from "../../core/ports.ts";
import type { ExamPipeline } from "../subagents/exam.ts";
import { serverExecute } from "../tool-execute.ts";

/** The exam agent's tools (prompts/exam/10-exam.md): define the exam, read
 *  its papers into the PYQ bank, check progress, start tests. */
export interface ExamToolContext {
	chatId: string;
	examStore: ExamStore;
	pipeline: ExamPipeline;
}

const marks = Type.Object({ correct: Type.Number(), wrong: Type.Number(), unanswered: Type.Number() });
const defineInput = Type.Object({
	name: Type.String({ minLength: 1, description: "The exam's name as the learner knows it." }),
	folder: Type.String({ minLength: 1, description: "The material folder inside PYQ/ (e.g. \"CGL\")." }),
	durationMin: Type.Integer({ minimum: 1 }),
	sections: Type.Array(Type.Object({
		name: Type.String({ minLength: 1 }),
		questionCount: Type.Integer({ minimum: 1 }),
		types: Type.Array(Type.Union([Type.Literal("mcq"), Type.Literal("msq"), Type.Literal("numeric")]), { minItems: 1 }),
		marks,
		topics: Type.Optional(Type.Array(Type.String())),
	}), { minItems: 1 }),
	topics: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, description: "Syllabus topics, in the names tests and mastery will use." }),
	notes: Type.Optional(Type.String()),
	dailyGoal: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Questions per day for the streak (default 20)." })),
});
const extractInput = Type.Object({
	papers: Type.Array(Type.Object({
		question: Type.String({ description: "Question paper file, relative to the exam folder." }),
		key: Type.Optional(Type.String({ description: "Its answer key (prefer the final key)." })),
		year: Type.Integer({ minimum: 1950, maximum: 2100 }),
		label: Type.String({ description: "Which paper: \"Prelim\", \"Mains Paper 2\"…" }),
	}), { minItems: 1 }),
});
const startInput = Type.Object({
	kind: Type.Union([Type.Literal("quiz"), Type.Literal("mock")], { description: "quiz: short and adaptive; mock: the full real pattern." }),
	questions: Type.Optional(Type.Integer({ minimum: 5, maximum: 30, description: "Quiz length (default 15)." })),
	minutes: Type.Optional(Type.Integer({ minimum: 3, maximum: 240, description: "Quiz time (default: the real exam's pace)." })),
});

function materialFiles(folder: string): string[] {
	const root = path.join(PATHS.pyq, folder);
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (/\.(pdf|txt|md)$/i.test(entry.name)) out.push(path.relative(root, full));
		}
	};
	try { walk(root); } catch { return []; }
	return out.sort();
}

export function examTools(ctx: ExamToolContext): Record<string, AgentTool<any>> {
	const examId = examIdForChat(ctx.chatId);
	const current = (): ExamDefinition => {
		const exam = ctx.examStore.getExam(examId);
		if (!exam) throw new Error("No exam defined for this session yet: call exam_define first.");
		return exam;
	};
	return {
		exam_define: {
			name: "exam_define",
			label: "exam_define",
			description: "Create or update this session's exam: its material folder, pattern (sections, types, marking), duration and syllabus topics.",
			parameters: defineInput,
			execute: serverExecute("exam_define", defineInput, (input) => {
				if (!fs.existsSync(path.join(PATHS.pyq, input.folder))) throw new Error(`There is no folder PYQ/${input.folder}/. Folders: ${fs.readdirSync(PATHS.pyq).filter((f) => !f.includes(".")).join(", ") || "(none)"}`);
				const before = ctx.examStore.getExam(examId);
				const exam: ExamDefinition = {
					id: examId, chatId: ctx.chatId, createdAt: before?.createdAt ?? new Date().toISOString(),
					name: input.name, folder: input.folder, durationMin: input.durationMin, sections: input.sections, topics: input.topics,
					dailyGoal: input.dailyGoal ?? before?.dailyGoal ?? 20, ...(input.notes ? { notes: input.notes } : {}),
				};
				ctx.examStore.saveExam(exam);
				return `Saved "${exam.name}". Dashboard: /exam/${examId}. Material files: ${materialFiles(exam.folder).length}. Next: pair papers with keys and call exam_extract_pyqs.`;
			}),
		},
		exam_status: {
			name: "exam_status",
			label: "exam_status",
			description: "This exam's state: material files and which are read, PYQ bank size, tests and scores, weak topics, readiness.",
			parameters: Type.Object({}),
			execute: serverExecute("exam_status", Type.Object({}), () => {
				const exam = current();
				const bank = ctx.examStore.readPyqs(examId);
				const extractions = ctx.examStore.readExtractions(examId);
				const read = new Map(extractions.map((e) => [e.file, e.items]));
				const notes = extractions.filter((e) => e.notes).map((e) => `- ${e.file}:\n${e.notes}`);
				const summary = examSummary(exam, ctx.examStore.readAttempts(examId));
				const tests = ctx.examStore.listTests(examId).slice(0, 10).map((t) => `- ${t.kind} ${t.id}: ${t.status}${t.status === "submitted" ? `, ${scoreTest(t, exam).score}/${scoreTest(t, exam).max}` : ""}${t.error ? ` (${t.error})` : ""}`);
				return [
					`Exam: ${exam.name} (PYQ/${exam.folder}/). Dashboard: /exam/${examId}`,
					`PYQ bank: ${bank.length} questions (${bank.filter((p) => isHeldOut(p.id)).length} held out for readiness).`,
					`Material:\n${materialFiles(exam.folder).map((f) => `- ${f}${read.has(f) ? ` (read: ${read.get(f)} questions)` : ""}`).join("\n")}`,
					notes.length ? `Extraction notes (questionable keys, unreadable pages):\n${notes.join("\n")}` : "",
					`Tests:\n${tests.join("\n") || "(none yet)"}`,
					`Focus: ${summary.focus.slice(0, 5).map((f) => `${f.topic} (${f.reason})`).join("; ")}`,
					`Readiness: ${summary.readiness.enough ? `${Math.round(summary.readiness.expected! * 100)}% of max (${Math.round(summary.readiness.low! * 100)}–${Math.round(summary.readiness.high! * 100)}%)` : `not enough evidence yet (${summary.readiness.probes} probes)`}`,
					`Today: ${summary.daily.today}/${summary.daily.goal} questions, streak ${summary.daily.streak}, XP ${summary.xp}.`,
				].filter(Boolean).join("\n\n");
			}),
		},
		exam_extract_pyqs: {
			name: "exam_extract_pyqs",
			label: "exam_extract_pyqs",
			description: "Read question papers (paired with their answer keys) into the PYQ bank, in the background. Already-read papers are skipped. Check progress with exam_status.",
			parameters: extractInput,
			execute: serverExecute("exam_extract_pyqs", extractInput, ({ papers }) => {
				const exam = current();
				const files = new Set(materialFiles(exam.folder));
				const missing = papers.flatMap((p) => [p.question, ...(p.key ? [p.key] : [])]).filter((f) => !files.has(f));
				if (missing.length) throw new Error(`Not in PYQ/${exam.folder}/: ${missing.join(", ")}`);
				ctx.pipeline.extractPapers(examId, papers, (paper, err) => console.error(`[exam ${examId}] reading ${paper} failed:`, err));
				return `Reading ${papers.length} paper(s) in the background, one at a time (a 40-page scan takes a few minutes). Tell the learner, then check with exam_status.`;
			}),
		},
		exam_start_test: {
			name: "exam_start_test",
			label: "exam_start_test",
			description: "Start a new timed test, generated fresh at or above PYQ level and weighted to the learner's weak and overconfident topics. Returns its link.",
			parameters: startInput,
			execute: serverExecute("exam_start_test", startInput, ({ kind, questions, minutes }) => {
				current();
				const test = ctx.pipeline.startTest(examId, kind, { questions, minutes }, (err) => console.error(`[exam ${examId}] test generation failed:`, err));
				return `Test ${test.id} is being written (a minute or two). Give the learner this link: [Open the ${kind === "mock" ? "mock test" : "quiz"}](/exam/${examId}/test/${test.id}). The page shows when it is ready; the timer starts when they begin.`;
			}),
		},
	};
}
