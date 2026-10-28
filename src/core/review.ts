/**
 * Spaced review of the knowledge map (owner, 2026-10-28): every map node
 * carries a Leitner card. A review set is a short, interleaved quiz over the
 * due nodes, one fresh question each, whose format fades with the node's
 * step: a worked example with a blank first, the full problem last. Pure:
 * the store and the question writer live outside the core.
 */
import { coerceCorrectAnswer, normalizeOptions, normalizeQuizFormat, type QuizFormat } from "./question-core.ts";

const DAY_MS = 86_400_000;

/** The gaps between reviews, in days, by step (0 = newest). */
export const REVIEW_GAPS_DAYS = [1, 3, 7, 16, 35] as const;
export const TOP_STEP = REVIEW_GAPS_DAYS.length - 1;
/** Confidence at or above this counts a right answer as known (90% or Certain). */
export const SURE_CONFIDENCE = 90;
/** Questions per review set at most. */
export const REVIEW_SET_SIZE = 8;

export interface ReviewCard {
	nodeId: string;
	step: number;
	/** ISO: when the node is next due. */
	due: string;
	/** ISO: the last time it was reviewed. */
	last?: string;
}

/** A new node's card: step 0, first review a day after it was learned. */
export function newCard(nodeId: string, learnedAt: string): ReviewCard {
	return { nodeId, step: 0, due: new Date(Date.parse(learnedAt) + REVIEW_GAPS_DAYS[0] * DAY_MS).toISOString() };
}

/** Leitner step: right and sure moves up, right but unsure stays, wrong (or "I don't know") restarts. */
export function nextCard(card: ReviewCard, outcome: { correct: boolean; confidence?: number }, now = Date.now()): ReviewCard {
	const step = !outcome.correct ? 0 : (outcome.confidence ?? 0) >= SURE_CONFIDENCE ? Math.min(card.step + 1, TOP_STEP) : card.step;
	return { nodeId: card.nodeId, step, due: new Date(now + REVIEW_GAPS_DAYS[step]! * DAY_MS).toISOString(), last: new Date(now).toISOString() };
}

/** Cards for the map as it is now: one per node (a new node starts at step 0), none for deleted nodes. */
export function syncCards(cards: readonly ReviewCard[], nodes: readonly { id: string; createdAt: string }[]): { cards: ReviewCard[]; changed: boolean } {
	const byNode = new Map(cards.map((c) => [c.nodeId, c]));
	const next = nodes.map((n) => byNode.get(n.id) ?? newCard(n.id, n.createdAt));
	return { cards: next, changed: next.length !== cards.length || next.some((c, i) => c !== cards[i]) };
}

/** Due cards, most overdue first. */
export function dueCards(cards: readonly ReviewCard[], now = Date.now()): ReviewCard[] {
	return cards.filter((c) => Date.parse(c.due) <= now).sort((a, b) => a.due.localeCompare(b.due));
}

/** Fading by step: a worked example with one blank, then whole steps to arrange or check, then the full problem. */
export function formatsForStep(step: number): QuizFormat[] {
	return step <= 1 ? ["fill_blank", "next_step"] : step < TOP_STEP ? ["order", "spot_error"] : ["choice"];
}

/** Interleave: no two neighbours share a group (a chain, a session) when the counts allow it.
 *  Greedy: always take from the largest remaining group that differs from the last one taken. */
export function interleave<T>(items: readonly T[], groupOf: (item: T) => string): T[] {
	const groups = new Map<string, T[]>();
	for (const item of items) groups.set(groupOf(item), [...(groups.get(groupOf(item)) ?? []), item]);
	const out: T[] = [];
	let last: string | undefined;
	while (out.length < items.length) {
		const ranked = [...groups.entries()].filter(([, g]) => g.length > 0).sort((a, b) => b[1].length - a[1].length);
		const [key, group] = ranked.find(([k]) => k !== last) ?? ranked[0]!;
		out.push(group.shift()!);
		last = key;
	}
	return out;
}

/** The quiz a review question carries: the teach quiz's authoring fields (question-core). */
export interface ReviewQuiz {
	question: string;
	format?: QuizFormat;
	lines?: string[];
	language?: string;
	options: { label: string; value?: string; misconception?: string }[];
	multiSelect?: boolean;
	explanation: string;
	correctAnswer: string | string[];
}

export interface ReviewQuestion {
	id: string;
	nodeId: string;
	nodeName: string;
	/** The node's statement, for "Explain this" (it seeds a lesson on the node). */
	nodeStatement: string;
	/** The node's step when the question was written (it set the format). */
	step: number;
	quiz: ReviewQuiz;
}

export interface ReviewAnswer {
	values: string[];
	dontKnow: boolean;
	confidence?: number;
	correct: boolean;
	at: string;
	/** The node's next review after this answer. */
	nextDue: string;
}

export interface ReviewSet {
	id: string;
	status: "generating" | "ready" | "done" | "failed";
	createdAt: string;
	questions: ReviewQuestion[];
	answers: Record<string, ReviewAnswer>;
	error?: string;
}

/** Grade option values against the quiz key: an exact set, or for `order` the exact sequence. */
export function gradeQuizValues(quiz: Pick<ReviewQuiz, "options" | "correctAnswer" | "format">, values: readonly string[]): boolean {
	const keys = normalizeOptions(quiz.options).map((o) => o.value);
	const key = coerceCorrectAnswer(quiz.correctAnswer, keys);
	if (normalizeQuizFormat(quiz.format) === "order") return values.length === key.length && values.every((v, i) => v === key[i]);
	const picked = new Set(values);
	return picked.size === new Set(key).size && key.every((v) => picked.has(v));
}
