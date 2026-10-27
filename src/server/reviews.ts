import { dueCards, gradeQuizValues, nextCard, type ReviewAnswer, type ReviewSet } from "../core/review.ts";
import { reviewPipeline } from "./chat-handler.ts";
import { stores } from "./stores.ts";

/**
 * The spaced-review service behind /api/reviews: the home card's numbers,
 * starting a set, and answering it. The server grades every answer and
 * moves the node's card; the review page only shows.
 */

export class ReviewError extends Error {
	constructor(message: string, readonly status: number) { super(message); }
}

export interface ReviewState {
	/** Nodes due now. */
	due: number;
	/** The soonest future review when nothing is due. */
	nextDue: string | null;
	/** Nodes on the schedule (every map node). */
	total: number;
	/** A set already started and not finished. */
	open: { id: string; status: ReviewSet["status"] } | null;
}

export function reviewState(now = Date.now()): ReviewState {
	const cards = reviewPipeline.cards();
	const due = dueCards(cards, now).length;
	const later = cards.filter((c) => Date.parse(c.due) > now).map((c) => c.due).sort()[0] ?? null;
	const open = stores.reviewStore.listSets().find((s) => s.status === "generating" || s.status === "ready");
	return { due, nextDue: due ? null : later, total: cards.length, open: open ? { id: open.id, status: open.status } : null };
}

export function startReview(): ReviewSet {
	let set: ReviewSet | null;
	try {
		set = reviewPipeline.startReview((err) => console.error("[review] writing failed:", err));
	} catch (err) {
		throw new ReviewError(err instanceof Error ? err.message : String(err), 503);
	}
	if (!set) throw new ReviewError("Nothing is due for review yet.", 409);
	return set;
}

export function getReview(id: string): ReviewSet {
	const set = stores.reviewStore.getSet(id);
	if (!set) throw new ReviewError("Unknown review", 404);
	return set;
}

/** Grade one answer, move its node's card, and close the set once every question is answered. */
export function answerReview(id: string, body: { questionId?: unknown; values?: unknown; dontKnow?: unknown; confidence?: unknown }, now = Date.now()): ReviewAnswer {
	const set = getReview(id);
	if (set.status !== "ready") throw new ReviewError("This review is not open for answers.", 409);
	const q = set.questions.find((x) => x.id === body.questionId);
	if (!q) throw new ReviewError("Unknown question", 400);
	if (set.answers[q.id]) throw new ReviewError("Already answered", 409);
	const dontKnow = body.dontKnow === true;
	const values = Array.isArray(body.values) ? body.values.filter((v): v is string => typeof v === "string") : [];
	if (!dontKnow && !values.length) throw new ReviewError("An answer needs values or dontKnow.", 400);
	const confidence = !dontKnow && typeof body.confidence === "number" ? Math.max(0, Math.min(100, Math.round(body.confidence))) : undefined;
	const correct = !dontKnow && gradeQuizValues(q.quiz, values);
	const cards = reviewPipeline.cards();
	const card = cards.find((c) => c.nodeId === q.nodeId) ?? { nodeId: q.nodeId, step: q.step, due: new Date(now).toISOString() };
	const moved = nextCard(card, { correct, confidence }, now);
	stores.reviewStore.saveCards([...cards.filter((c) => c.nodeId !== q.nodeId), moved]);
	const answer: ReviewAnswer = { values, dontKnow, ...(confidence !== undefined ? { confidence } : {}), correct, at: new Date(now).toISOString(), nextDue: moved.due };
	const answers = { ...set.answers, [q.id]: answer };
	stores.reviewStore.saveSet({ ...set, answers, status: Object.keys(answers).length === set.questions.length ? "done" : "ready" });
	return answer;
}
