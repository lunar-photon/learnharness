import * as fs from "node:fs";
import * as path from "node:path";
import type { Tool } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import { nanoid } from "nanoid";
import { PATHS, type ModelRole } from "../../../config.ts";
import type { GraphChain, GraphNode } from "../../core/contracts/graph.ts";
import { quizFormatSchema, quizInputProblems } from "../../core/question-core.ts";
import { REVIEW_SET_SIZE, dueCards, formatsForStep, interleave, syncCards, type ReviewCard, type ReviewQuestion, type ReviewSet } from "../../core/review.ts";
import type { ReviewStore } from "../../core/ports.ts";
import type { PiEngine } from "../models.ts";
import { submitOnce } from "./exam.ts";

/**
 * Spaced review of the knowledge map (core/review.ts): keeps one card per
 * map node, and writes a review set — one fresh question per due node, in
 * the format its step allows, interleaved across chains — in the
 * background. The review store is the only output.
 */

const prompt = () => fs.readFileSync(path.join(PATHS.root, "src", "agent", "prompts", "roles", "review_writer.md"), "utf-8");
const ROUNDS = 2;

export interface ReviewPipelineDeps {
	reviewStore: ReviewStore;
	graph: { readNodes(): GraphNode[]; readChains(): GraphChain[] };
	engineFor: (role: ModelRole) => PiEngine | undefined;
}

const reviewQuestion = Type.Object({
	nodeId: Type.String(),
	format: quizFormatSchema(),
	question: Type.String({ minLength: 1 }),
	lines: Type.Optional(Type.Array(Type.String())),
	language: Type.Optional(Type.String()),
	options: Type.Array(Type.Object({ label: Type.String({ minLength: 1 }), value: Type.String({ minLength: 1 }) }), { minItems: 2 }),
	multiSelect: Type.Optional(Type.Boolean()),
	explanation: Type.String({ minLength: 1 }),
	correctAnswer: Type.Union([Type.String(), Type.Array(Type.String())]),
});
const submitTool = {
	name: "submit_review_questions",
	description: "Submit one review question per due node.",
	parameters: Type.Object({ questions: Type.Array(reviewQuestion) }),
} satisfies Tool;
type Written = Static<typeof reviewQuestion>;

/** Why a written question can't be shown, or null. */
export function reviewQuestionProblem(q: Written, card: ReviewCard | undefined): string | null {
	if (!card) return `nodeId "${q.nodeId}" is not one of the due nodes`;
	const allowed = formatsForStep(card.step);
	if (!allowed.includes(q.format)) return `node ${q.nodeId} is on step ${card.step}: use format ${allowed.join(" or ")}, not ${q.format}`;
	const problems = quizInputProblems(q);
	return problems.length ? `node ${q.nodeId}: ${problems.join(" ")}` : null;
}

export function createReviewPipeline(deps: ReviewPipelineDeps) {
	/** The cards for the map as it is now (new nodes join at step 0; saved when that changes anything). */
	function cards(): ReviewCard[] {
		const synced = syncCards(deps.reviewStore.readCards(), deps.graph.readNodes());
		if (synced.changed) deps.reviewStore.saveCards(synced.cards);
		return synced.cards;
	}

	/** The open set if there is one, else a new set over the due nodes (null when nothing is due). */
	function startReview(onError: (err: unknown) => void = () => {}, now = Date.now()): ReviewSet | null {
		const open = deps.reviewStore.listSets().find((s) => s.status === "generating" || s.status === "ready");
		if (open) return open;
		const due = dueCards(cards(), now).slice(0, REVIEW_SET_SIZE);
		if (!due.length) return null;
		if (!deps.engineFor("testGenerator")) throw new Error("No model is set for writing reviews (strong slot).");
		const set: ReviewSet = { id: `r_${nanoid(10)}`, status: "generating", createdAt: new Date(now).toISOString(), questions: [], answers: {} };
		deps.reviewStore.saveSet(set);
		void generate(set, due).catch((err) => {
			deps.reviewStore.saveSet({ ...set, status: "failed", error: err instanceof Error ? err.message : String(err) });
			onError(err);
		});
		return set;
	}

	async function generate(set: ReviewSet, due: ReviewCard[], signal?: AbortSignal): Promise<void> {
		const engine = deps.engineFor("testGenerator");
		if (!engine) throw new Error("No model is set for writing reviews (strong slot).");
		const nodes = new Map(deps.graph.readNodes().map((n) => [n.id, n]));
		const chains = deps.graph.readChains();
		const describe = (card: ReviewCard) => {
			const n = nodes.get(card.nodeId)!;
			const from = chains.filter((c) => c.conclusion === n.id).flatMap((c) => c.premises).map((id) => nodes.get(id)?.statement).filter(Boolean);
			const to = chains.filter((c) => c.premises.includes(n.id)).map((c) => nodes.get(c.conclusion)?.statement).filter(Boolean);
			return [
				`[${n.id}] ${n.name}: ${n.statement}`,
				n.aliases.length ? `Learned as: ${n.aliases.slice(0, 3).join(" | ")}` : "",
				from.length ? `Follows from: ${from.join(" | ")}` : "",
				to.length ? `Leads to: ${to.join(" | ")}` : "",
				`Step ${card.step}: format ${formatsForStep(card.step).join(" or ")}`,
			].filter(Boolean).join("\n");
		};
		const byNode = new Map(due.filter((c) => nodes.has(c.nodeId)).map((c) => [c.nodeId, c]));
		const written: ReviewQuestion[] = [];
		let problems: string[] = [];
		for (let round = 0; round < ROUNDS && written.length < byNode.size; round++) {
			const left = [...byNode.values()].filter((c) => !written.some((w) => w.nodeId === c.nodeId));
			const text = [
				`Write one review question for each of these ${left.length} due node(s):`,
				left.map(describe).join("\n\n"),
				problems.length ? `Your previous questions for some of these were rejected:\n- ${problems.join("\n- ")}` : "",
			].filter(Boolean).join("\n\n");
			const out = await submitOnce<{ questions: Written[] }>(engine, prompt(), [{ type: "text", text }], submitTool, signal);
			problems = [];
			for (const q of out.questions) {
				const card = left.find((c) => c.nodeId === q.nodeId);
				const problem = written.some((w) => w.nodeId === q.nodeId) ? null : reviewQuestionProblem(q, card);
				if (problem) { problems.push(problem); continue; }
				if (!card || written.some((w) => w.nodeId === q.nodeId)) continue;
				const { nodeId, ...quiz } = q;
				const node = nodes.get(nodeId)!;
				written.push({ id: `q_${nanoid(8)}`, nodeId, nodeName: node.name, nodeStatement: node.statement, step: card.step, quiz });
			}
		}
		if (!written.length) throw new Error(`The review writer produced no usable questions${problems.length ? `: ${problems.slice(0, 3).join("; ")}` : "."}`);
		// Interleave across chains of ideas (else across the lessons they came from).
		const groupOf = (q: ReviewQuestion) =>
			chains.find((c) => c.conclusion === q.nodeId || c.premises.includes(q.nodeId))?.id ?? nodes.get(q.nodeId)?.provenance[0]?.chatId ?? q.nodeId;
		deps.reviewStore.saveSet({ ...set, status: "ready", questions: interleave(written, groupOf) });
	}

	return { cards, startReview };
}

export type ReviewPipeline = ReturnType<typeof createReviewPipeline>;
