import { FEEDBACK_REASON_LABELS, type ExplanationFeedback, type ExplanationPair, type LearnerEntry, type LearnerEntryKind } from "./contracts/learner.ts";

/**
 * Pure learner-profile logic (contracts/learner.ts): explanation pairs
 * from feedback, the live profile, and the prompt summary.
 */

/** Per session, each "landed" pairs with the earliest still-unpaired
 *  "didn't land" before it: the first explanation vs the one the learner liked. */
export function explanationPairs(feedback: readonly ExplanationFeedback[]): ExplanationPair[] {
	const pairs: ExplanationPair[] = [];
	const misses = new Map<string, ExplanationFeedback[]>();
	for (const f of [...feedback].sort((a, b) => a.at.localeCompare(b.at))) {
		const open = misses.get(f.chatId) ?? [];
		if (!f.landed) {
			if (!open.some((m) => m.messageId === f.messageId)) open.push(f);
			misses.set(f.chatId, open);
			continue;
		}
		const first = open.find((m) => m.messageId !== f.messageId);
		if (!first) continue;
		open.splice(open.indexOf(first), 1);
		pairs.push({ chatId: f.chatId, firstMessageId: first.messageId, likedMessageId: f.messageId, reasons: first.reasons, ...(first.note ? { note: first.note } : {}) });
	}
	return pairs;
}

export const pairKey = (p: ExplanationPair) => `${p.chatId}:${p.firstMessageId}>${p.likedMessageId}`;

/** Entries still in force: anything a later entry supersedes drops out. */
export function liveEntries(entries: readonly LearnerEntry[]): LearnerEntry[] {
	const superseded = new Set(entries.flatMap((e) => (e.supersedes ? [e.supersedes] : [])));
	return entries.filter((e) => !superseded.has(e.id));
}

const SECTION: Readonly<Record<LearnerEntryKind, string>> = {
	preference: "How they like ideas framed",
	fluency: "Notation and methods they read fluently",
	knowledge: "What they hold",
	misconception: "Misconceptions and shaky ground",
	outcome: "How past explanations went",
};

/** Fluency is context-dependent: older than this it is shown as not recent. */
const RECENT_MS = 30 * 24 * 3600_000;

/** The profile as the teacher's prompt sees it: newest first per section,
 *  capped so the prompt stays small. Empty profile → "". */
export function profileSummary(entries: readonly LearnerEntry[], now = Date.now(), perSection = 12): string {
	const live = liveEntries(entries);
	if (!live.length) return "";
	const lines: string[] = [];
	for (const kind of Object.keys(SECTION) as LearnerEntryKind[]) {
		const items = live.filter((e) => e.kind === kind).sort((a, b) => b.at.localeCompare(a.at)).slice(0, perSection);
		if (!items.length) continue;
		lines.push(`### ${SECTION[kind]}`);
		for (const e of items) {
			const stale = kind === "fluency" && now - Date.parse(e.at) > RECENT_MS ? ", not recent" : "";
			lines.push(`- ${e.topic ? `**${e.topic}:** ` : ""}${e.statement} _(${e.at.slice(0, 10)}, ${e.confidence} confidence${stale})_`);
		}
	}
	return lines.join("\n");
}

/** The learner-facing message a "didn't land" sends to the teacher. */
export function feedbackMessage(reasons: readonly (keyof typeof FEEDBACK_REASON_LABELS)[], note?: string): string {
	const why = reasons.map((r) => FEEDBACK_REASON_LABELS[r].toLowerCase()).join(", ");
	return `That explanation didn't land${why ? ` (${why})` : ""}.${note?.trim() ? ` ${note.trim()}` : ""}`;
}

/** Misses the teacher has not yet answered: "didn't land" verdicts in this
 *  chat newer than the last teacher message, formatted for the prompt. */
export function pendingFeedbackNote(
	feedback: readonly ExplanationFeedback[],
	chatId: string,
	lastTeacherAt: number,
	excerptOf: (messageId: string) => string,
): string {
	const misses = feedback.filter((f) => f.chatId === chatId && !f.landed && Date.parse(f.at) > lastTeacherAt);
	if (!misses.length) return "";
	const lines = misses.map((f) => {
		const why = f.reasons.map((r) => FEEDBACK_REASON_LABELS[r].toLowerCase()).join(", ") || "no reason given";
		return `- "${excerptOf(f.messageId)}…" did not land (${why})${f.note ? `; the learner adds: "${f.note}"` : ""}.`;
	});
	return `### Explanations that did not land (unanswered)\nRe-explain each from a different starting point or representation, addressing the reason, before moving on.\n${lines.join("\n")}`;
}
