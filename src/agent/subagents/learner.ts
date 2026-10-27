import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import { nanoid } from "nanoid";
import { PATHS, type ModelRole } from "../../../config.ts";
import { LEARNER_ENTRY_KINDS, type LearnerEntry } from "../../core/contracts/learner.ts";
import { explanationPairs, liveEntries, pairKey } from "../../core/learner.ts";
import { messageMarkdown, sessionMarkdown } from "../../core/session-markdown.ts";
import type { LhMessage } from "../../core/native-messages.ts";
import type { ChatStore, LearnerStore } from "../../core/ports.ts";
import type { PiEngine } from "../models.ts";
import { runSubmitAgent } from "./submit-agent.ts";

/**
 * THE LEARNER PIPELINE (docs/agent-driver-plan.md §5): after a turn, the
 * learner-modeler reads the session's new messages and records what they
 * show about how the learner understands; the explanation-reviewer turns
 * each new first-vs-liked explanation pair into preference entries and a
 * learner-sourced library example. Sole writer of the learner store's
 * profile and examples (the feedback route writes verdicts). Single-flight
 * per chat; an unconfigured model skips quietly and retries next turn.
 */

const ROLES_DIR = path.join(PATHS.root, "src", "agent", "prompts", "roles");
const rolePrompt = (name: string) => fs.readFileSync(path.join(ROLES_DIR, `${name}.md`), "utf-8");

const entryInput = Type.Object({
	kind: Type.Union(LEARNER_ENTRY_KINDS.map((k) => Type.Literal(k))),
	topic: Type.Optional(Type.String()),
	statement: Type.String({ minLength: 1 }),
	confidence: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
	messageIds: Type.Array(Type.String(), { description: "Ids of the messages that are the evidence (from the excerpt's ### headings)." }),
	supersedes: Type.Optional(Type.String({ description: "Id of the existing entry this one corrects or replaces." })),
});
const modelerSchema = Type.Object({ entries: Type.Array(entryInput) });

const reviewSchema = Type.Object({
	preferences: Type.Array(Type.Object({ topic: Type.Optional(Type.String()), statement: Type.String({ minLength: 1 }), confidence: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]) })),
	example: Type.Object({
		slug: Type.String({ minLength: 1 }),
		title: Type.String({ minLength: 1 }),
		lesson: Type.String({ minLength: 1 }),
		generic: Type.String({ minLength: 1 }),
		preferred: Type.String({ minLength: 1 }),
		teachingLesson: Type.String({ minLength: 1 }),
	}),
});

type ModelerOut = { entries: { kind: LearnerEntry["kind"]; topic?: string; statement: string; confidence: LearnerEntry["confidence"]; messageIds: string[]; supersedes?: string }[] };
type ReviewOut = { preferences: { topic?: string; statement: string; confidence: LearnerEntry["confidence"] }[]; example: { slug: string; title: string; lesson: string; generic: string; preferred: string; teachingLesson: string } };

export interface LearnerPipelineDeps {
	chatStore: ChatStore;
	learnerStore: LearnerStore;
	engineFor: (role: ModelRole) => PiEngine | undefined;
}

const idOf = (m: LhMessage) => (m as { id?: string }).id ?? "";
const noop = () => {};

export function exampleMarkdown(e: ReviewOut["example"]): string {
	return `# ${e.title}\n\nLesson: ${e.lesson}\n\n## Generic answer\n\n${e.generic}\n\n## Preferred construction\n\n${e.preferred}\n\n## Teaching lesson\n\n${e.teachingLesson}\n`;
}

export function createLearnerPipeline(deps: LearnerPipelineDeps) {
	const running = new Set<string>();

	async function model(chatId: string, messages: LhMessage[], known: Set<string>, engine: PiEngine, signal?: AbortSignal): Promise<LearnerEntry[]> {
		// Only the learner's own input is evidence: no new user message or answer, nothing to model.
		if (!messages.some((m) => m.role === "user" || m.role === "toolResult")) return [];
		const excerpt = sessionMarkdown(messages, { anchors: true });
		const live = liveEntries(deps.learnerStore.readEntries());
		const profile = live.map((e) => `- [${e.id}] ${e.kind}${e.topic ? ` · ${e.topic}` : ""}: ${e.statement} (${e.confidence})`).join("\n") || "(empty)";
		const feedback = deps.learnerStore.readFeedback().filter((f) => f.chatId === chatId && known.has(f.messageId))
			.map((f) => `- on ${f.messageId}: ${f.landed ? "landed" : `did not land (${f.reasons.join(", ") || "no reason given"})`}${f.note ? ` — "${f.note}"` : ""}`).join("\n");
		const out = await runSubmitAgent<ModelerOut>({
			role: "learnerModeler",
			chatId,
			toolName: "submit_profile_entries",
			toolDescription: "Submit the new learner-profile entries (an empty list when the excerpt shows nothing new).",
			parameters: modelerSchema,
			fill: (input) => ({ entries: input.entries ?? [] }),
			validate: (v) => {
				const bad = v.entries.flatMap((e) => e.messageIds.filter((id) => !known.has(id)));
				const ghosts = v.entries.flatMap((e) => (e.supersedes && !live.some((l) => l.id === e.supersedes) ? [e.supersedes] : []));
				return bad.length ? `Unknown message ids: ${bad.join(", ")}` : ghosts.length ? `Unknown entry ids in supersedes: ${ghosts.join(", ")}` : null;
			},
			systemPrompt: rolePrompt("learner_modeler"),
			prompt: `## Current profile\n\n${profile}\n\n## Feedback on explanations\n\n${feedback || "(none)"}\n\n## New session excerpt (${chatId})\n\n${excerpt}`,
			engine,
			signal,
			onStep: noop,
			neverSubmitted: "the learner modeler never submitted",
		});
		const at = new Date().toISOString();
		return out.entries.map((e) => ({
			id: `le_${nanoid(10)}`, at, kind: e.kind, ...(e.topic ? { topic: e.topic } : {}), statement: e.statement, confidence: e.confidence,
			evidence: e.messageIds.length ? e.messageIds.map((messageId) => ({ chatId, messageId })) : [{ chatId }],
			...(e.supersedes ? { supersedes: e.supersedes } : {}),
		}));
	}

	async function review(chatId: string, messages: LhMessage[], pair: ReturnType<typeof explanationPairs>[number], engine: PiEngine, signal?: AbortSignal) {
		const from = messages.findIndex((m) => idOf(m) === pair.firstMessageId);
		const to = messages.findIndex((m) => idOf(m) === pair.likedMessageId);
		if (from < 0 || to <= from) return null;
		const render = (m: LhMessage) => messageMarkdown(m, idOf(m), false) ?? "";
		const prompt = [
			"Your job now: Job 2, extract the learning style from this pair.",
			`## First explanation (did not land — reasons: ${pair.reasons.join(", ") || "none given"}${pair.note ? `; note: "${pair.note}"` : ""})\n\n${render(messages[from]!)}`,
			`## Discussion in between\n\n${sessionMarkdown(messages.slice(from + 1, to), { anchors: false }) || "(none)"}`,
			`## The explanation the learner said landed\n\n${render(messages[to]!)}`,
		].join("\n\n");
		const out = await runSubmitAgent<ReviewOut>({
			role: "explanationReviewer",
			chatId,
			toolName: "submit_style",
			toolDescription: "Submit the preferences this pair shows and the pair written up as a library example.",
			parameters: reviewSchema,
			fill: (input) => input as ReviewOut,
			systemPrompt: rolePrompt("explanation_reviewer"),
			prompt,
			engine,
			signal,
			onStep: noop,
			neverSubmitted: "the explanation reviewer never submitted",
		});
		const at = new Date().toISOString();
		const evidence = [{ chatId, messageId: pair.firstMessageId }, { chatId, messageId: pair.likedMessageId }];
		const entries: LearnerEntry[] = out.preferences.map((p) => ({ id: `le_${nanoid(10)}`, at, kind: "preference", ...(p.topic ? { topic: p.topic } : {}), statement: p.statement, confidence: p.confidence, evidence }));
		return { entries, example: out.example };
	}

	/** Model the chat's new messages and review its new explanation pairs. */
	async function runLearnerUpdate(chatId: string, signal?: AbortSignal): Promise<{ entries: number; examples: number }> {
		if (running.has(chatId)) return { entries: 0, examples: 0 };
		running.add(chatId);
		try {
			const record = deps.chatStore.getChat(chatId);
			if (!record) return { entries: 0, examples: 0 };
			const state = deps.learnerStore.readState();
			const from = Math.min(state.chats[chatId] ?? 0, record.messages.length);
			const messages = record.messages;
			const known = new Set(messages.map(idOf).filter(Boolean));
			let entries = 0, examples = 0;

			const modeler = deps.engineFor("learnerModeler");
			if (modeler && from < messages.length) {
				const added = await model(chatId, messages.slice(from), known, modeler, signal);
				deps.learnerStore.appendEntries(added);
				entries += added.length;
				state.chats[chatId] = messages.length;
			}

			const reviewer = deps.engineFor("explanationReviewer");
			const done = new Set(state.pairs);
			for (const pair of explanationPairs(deps.learnerStore.readFeedback()).filter((p) => p.chatId === chatId && !done.has(pairKey(p)))) {
				if (!reviewer) break;
				const result = await review(chatId, messages, pair, reviewer, signal);
				if (result) {
					deps.learnerStore.appendEntries(result.entries);
					deps.learnerStore.writeExample(result.example.slug, exampleMarkdown(result.example));
					entries += result.entries.length;
					examples++;
				}
				state.pairs.push(pairKey(pair));
			}
			deps.learnerStore.writeState(state);
			return { entries, examples };
		} finally {
			running.delete(chatId);
		}
	}

	return { runLearnerUpdate };
}

export type LearnerPipeline = ReturnType<typeof createLearnerPipeline>;
