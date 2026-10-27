/**
 * The learner profile domain (docs/agent-driver-plan.md §5): what the
 * learner-modeler and explanation-reviewer roles learn about HOW this
 * learner understands — knowledge, representational fluency, preferences,
 * misconceptions — each entry dated and tied to the session evidence.
 * Distinct from the knowledge graph, which maps domain ideas, not the
 * learner. Append-only; superseded entries stay as history.
 */

export const LEARNER_ENTRY_KINDS = ["knowledge", "fluency", "preference", "misconception", "outcome"] as const;
export type LearnerEntryKind = (typeof LEARNER_ENTRY_KINDS)[number];

export interface LearnerEvidence {
	chatId: string;
	messageId?: string;
}

export interface LearnerEntry {
	id: string;
	/** ISO time the entry was written. */
	at: string;
	kind: LearnerEntryKind;
	/** Subject area or concept the entry is about ("CMB lensing", "index notation"). */
	topic?: string;
	statement: string;
	confidence: "low" | "medium" | "high";
	evidence: LearnerEvidence[];
	/** An earlier entry this one replaces (corrected or outdated). */
	supersedes?: string;
}

/** Why an explanation did not land — the guide's failure reasons. */
export const FEEDBACK_REASONS = ["starting-point", "skipped-step", "notation", "analogy", "too-much", "too-little"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export const FEEDBACK_REASON_LABELS: Readonly<Record<FeedbackReason, string>> = {
	"starting-point": "Wrong starting point",
	"skipped-step": "Skipped a step",
	notation: "Unfamiliar notation",
	analogy: "Misleading analogy",
	"too-much": "Too much at once",
	"too-little": "Too thin",
};

/** The learner's verdict on one teacher explanation. */
export interface ExplanationFeedback {
	id: string;
	at: string;
	chatId: string;
	messageId: string;
	landed: boolean;
	reasons: FeedbackReason[];
	note?: string;
}

/** A first explanation that did not land and the later one the learner
 *  liked, in the same session — derived from feedback, never stored. */
export interface ExplanationPair {
	chatId: string;
	firstMessageId: string;
	likedMessageId: string;
	/** What the learner said was wrong with the first one. */
	reasons: FeedbackReason[];
	note?: string;
}
