/**
 * Spaced review of the knowledge map (core/review.ts, the review writer,
 * /api/reviews): the Leitner steps, fading by step, interleaving, server
 * grading, and the routes over an isolated data dir.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import type { GraphNode } from "../src/core/contracts/graph.ts";
import {
	REVIEW_GAPS_DAYS, dueCards, formatsForStep, gradeQuizValues, interleave, newCard, nextCard, syncCards,
	type ReviewCard, type ReviewSet,
} from "../src/core/review.ts";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-review-"));
process.env.LH_DATA_DIR = TMP_DATA;
after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-28T12:00:00Z");
const card = (step: number, nodeId = "n1"): ReviewCard => ({ nodeId, step, due: new Date(NOW).toISOString() });
const days = (c: ReviewCard) => Math.round((Date.parse(c.due) - NOW) / DAY);

describe("the Leitner schedule", () => {
	it("right and sure steps up, right but unsure stays, wrong restarts", () => {
		assert.equal(nextCard(card(1), { correct: true, confidence: 90 }, NOW).step, 2);
		assert.equal(nextCard(card(1), { correct: true, confidence: 100 }, NOW).step, 2);
		assert.equal(nextCard(card(2), { correct: true, confidence: 70 }, NOW).step, 2);
		assert.equal(nextCard(card(3), { correct: false, confidence: 100 }, NOW).step, 0);
		assert.equal(nextCard(card(4), { correct: true, confidence: 100 }, NOW).step, 4, "the top step holds");
	});
	it("the gap is the new step's: 1, 3, 7, 16, 35 days", () => {
		assert.deepEqual([0, 1, 2, 3, 4].map((s) => days(nextCard(card(s), { correct: true, confidence: 70 }, NOW))), [...REVIEW_GAPS_DAYS]);
		assert.equal(days(nextCard(card(3), { correct: false }, NOW)), 1);
	});
	it("a new node is first due a day after it was learned; due cards come most overdue first", () => {
		assert.equal(newCard("n", new Date(NOW).toISOString()).due, new Date(NOW + DAY).toISOString());
		const cards = [{ ...card(0, "late"), due: new Date(NOW - 3 * DAY).toISOString() }, { ...card(0, "later"), due: new Date(NOW - DAY).toISOString() }, { ...card(0, "future"), due: new Date(NOW + DAY).toISOString() }];
		assert.deepEqual(dueCards(cards, NOW).map((c) => c.nodeId), ["late", "later"]);
	});
	it("syncCards adds new map nodes and drops deleted ones, keeping progress", () => {
		const kept = { ...card(3, "a"), due: "2026-11-01T00:00:00.000Z" };
		const { cards, changed } = syncCards([kept, card(1, "gone")], [{ id: "a", createdAt: "2026-10-01T00:00:00Z" }, { id: "b", createdAt: "2026-10-27T00:00:00Z" }]);
		assert.equal(changed, true);
		assert.deepEqual(cards.map((c) => [c.nodeId, c.step]), [["a", 3], ["b", 0]]);
		assert.equal(cards[0], kept);
		assert.equal(syncCards(cards, [{ id: "a", createdAt: "x" }, { id: "b", createdAt: "x" }]).changed, false);
	});
});

describe("fading and interleaving", () => {
	it("formats fade with the step: blank in a worked example, then whole steps, then the full problem", () => {
		assert.deepEqual(formatsForStep(0), ["fill_blank", "next_step"]);
		assert.deepEqual(formatsForStep(1), ["fill_blank", "next_step"]);
		assert.deepEqual(formatsForStep(2), ["order", "spot_error"]);
		assert.deepEqual(formatsForStep(3), ["order", "spot_error"]);
		assert.deepEqual(formatsForStep(4), ["choice"]);
	});
	it("no two neighbours share a group when the counts allow it", () => {
		const items = ["a1", "a2", "a3", "b1", "b2", "c1"];
		const out = interleave(items, (s) => s[0]!);
		assert.equal(out.length, items.length);
		assert.deepEqual([...out].sort(), [...items].sort());
		for (let i = 1; i < out.length; i++) assert.notEqual(out[i]![0], out[i - 1]![0], out.join(","));
	});
});

describe("grading", () => {
	const options = [{ label: "K", value: "k" }, { label: "K^T", value: "kt" }, { label: "I+K", value: "ik" }];
	it("an exact set, or for order the exact sequence", () => {
		assert.equal(gradeQuizValues({ options, correctAnswer: "k" }, ["k"]), true);
		assert.equal(gradeQuizValues({ options, correctAnswer: "k" }, ["kt"]), false);
		assert.equal(gradeQuizValues({ options, correctAnswer: ["k", "ik"] }, ["ik", "k"]), true);
		assert.equal(gradeQuizValues({ options, correctAnswer: ["k", "ik"] }, ["k"]), false);
		assert.equal(gradeQuizValues({ options, correctAnswer: ["k", "kt", "ik"], format: "order" }, ["k", "kt", "ik"]), true);
		assert.equal(gradeQuizValues({ options, correctAnswer: ["k", "kt", "ik"], format: "order" }, ["kt", "k", "ik"]), false);
	});
});

describe("the review writer", async () => {
	const { createReviewPipeline, reviewQuestionProblem } = await import("../src/agent/subagents/review.ts");
	const node = (id: string, chatId: string): GraphNode => ({ id, name: `Idea ${id}`, statement: `Statement ${id}`, aliases: [], createdAt: new Date(NOW - 5 * DAY).toISOString(), provenance: [{ chatId, messageId: "m" }] });
	const fill = (nodeId: string) => ({ nodeId, format: "fill_blank" as const, question: `Fill ${nodeId}`, lines: ["$$ x = ___ $$"], options: [{ label: "a", value: "a" }, { label: "b", value: "b" }], explanation: "e", correctAnswer: "a" });

	it("rejects a question in a format its node's step doesn't allow", () => {
		assert.match(reviewQuestionProblem({ ...fill("n1"), format: "choice" }, card(0)) ?? "", /use format fill_blank or next_step/);
		assert.equal(reviewQuestionProblem(fill("n1"), card(0)), null);
		assert.match(reviewQuestionProblem(fill("zz"), undefined) ?? "", /not one of the due nodes/);
	});

	it("writes one question per due node, returns rejects for a second round, and interleaves the set", async () => {
		const sets: ReviewSet[] = [];
		let cards: ReviewCard[] = [];
		const nodes = [node("a1", "chatA"), node("a2", "chatA"), node("b1", "chatB")];
		const calls: string[] = [];
		const replies = [
			// round 1: a2 in the wrong format, the rest fine
			[fill("a1"), { ...fill("a2"), format: "choice" }, fill("b1")],
			// round 2: a2 fixed
			[fill("a2")],
		];
		const engine = {
			model: { provider: "fixture", id: "fixture" },
			streamFn: (_m: unknown, ctx: { messages: { content: unknown }[] }) => ({
				result: async () => {
					calls.push(JSON.stringify(ctx.messages.at(-1)!.content));
					return { role: "assistant", stopReason: "toolUse", content: [{ type: "toolCall", id: `c${calls.length}`, name: "submit_review_questions", arguments: { questions: replies[calls.length - 1] } }] };
				},
			}),
		};
		const pipeline = createReviewPipeline({
			reviewStore: { readCards: () => cards, saveCards: (c) => { cards = [...c]; }, listSets: () => sets, getSet: (id) => sets.find((s) => s.id === id) ?? null, saveSet: (s) => { const i = sets.findIndex((x) => x.id === s.id); if (i >= 0) sets[i] = s; else sets.push(s); } },
			graph: { readNodes: () => nodes, readChains: () => [] },
			engineFor: () => engine as never,
		});
		const set = pipeline.startReview(undefined, NOW)!;
		assert.equal(set.status, "generating");
		for (let i = 0; i < 50 && sets[0]!.status === "generating"; i++) await new Promise((r) => setImmediate(r));
		const ready = sets[0]!;
		assert.equal(ready.status, "ready", ready.error);
		assert.equal(calls.length, 2, "a second round for the rejected node");
		assert.match(calls[1]!, /use format fill_blank or next_step/);
		assert.deepEqual([...ready.questions.map((q) => q.nodeId)].sort(), ["a1", "a2", "b1"]);
		const groups = ready.questions.map((q) => nodes.find((n) => n.id === q.nodeId)!.provenance[0]!.chatId);
		assert.notEqual(groups[0], groups[1], "interleaved: the two chatA ideas aren't neighbours at the start");
		assert.equal(pipeline.startReview(undefined, NOW)!.id, ready.id, "an open set is returned, not duplicated");
	});
});

describe("the review routes", async () => {
	const { graphStore } = await import("../src/store/graph.ts");
	const { reviewStore } = await import("../src/store/reviews.ts");
	const reviews = await import("../app/api/reviews/route.ts");
	const answerRoute = await import("../app/api/reviews/[id]/answer/route.ts");
	const post = (id: string, body: object) => answerRoute.POST(new Request("http://t", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

	it("counts due map nodes, grades answers server-side, moves the card, and closes the set", async () => {
		const learned = new Date(Date.now() - 3 * DAY).toISOString();
		for (const id of ["r1", "r2"]) graphStore.appendNode({ id, name: id, statement: `s ${id}`, aliases: [], createdAt: learned, provenance: [] });
		const state = await (reviews.GET()).json();
		assert.equal(state.total, 2);
		assert.equal(state.due, 2);
		const quiz = { question: "q", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }], explanation: "e", correctAnswer: "a" };
		reviewStore.saveSet({ id: "r_fixture", status: "ready", createdAt: new Date().toISOString(), answers: {}, questions: [
			{ id: "q1", nodeId: "r1", nodeName: "r1", nodeStatement: "s r1", step: 0, quiz },
			{ id: "q2", nodeId: "r2", nodeName: "r2", nodeStatement: "s r2", step: 0, quiz },
		] });
		assert.equal((await post("r_fixture", { questionId: "q1" })).status, 400, "an answer needs values");
		const right = await (await post("r_fixture", { questionId: "q1", values: ["a"], confidence: 100 })).json();
		assert.equal(right.correct, true);
		assert.equal((await post("r_fixture", { questionId: "q1", values: ["a"] })).status, 409, "answered once");
		const wrong = await (await post("r_fixture", { questionId: "q2", values: ["b"], confidence: 90 })).json();
		assert.equal(wrong.correct, false, "the server grades, whatever the client thought");
		const cards = reviewStore.readCards();
		assert.equal(cards.find((c) => c.nodeId === "r1")!.step, 1, "right and certain: up a step");
		assert.equal(cards.find((c) => c.nodeId === "r2")!.step, 0, "wrong: back to the start");
		assert.equal(reviewStore.getSet("r_fixture")!.status, "done");
		const after = await (reviews.GET()).json();
		assert.equal(after.due, 0);
		assert.ok(after.nextDue, "the next review is announced");
	});
});
