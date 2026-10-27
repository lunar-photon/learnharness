/**
 * The learner profile (docs/agent-driver-plan.md §5): pure pair detection,
 * superseding and the prompt summary; the pipeline's two roles on a
 * scripted model with an in-memory store (message-id validation retries,
 * pair review → preference entries + a library example); the feedback
 * route's validation; the profile reaching the teacher's system prompt.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, type FauxResponseStep, type ToolCall } from "@earendil-works/pi-ai";
import type { ExplanationFeedback, LearnerEntry } from "../src/core/contracts/learner.ts";
import type { ChatStore, LearnerPipelineState, LearnerStore } from "../src/core/ports.ts";

// The data seam BEFORE any config-loading import: the feedback route writes
// the learner store, which must never be the developer's real data/.
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-learner-"));
process.env.LH_DATA_DIR = TMP_DATA;
const { explanationPairs, liveEntries, pendingFeedbackNote, profileSummary } = await import("../src/core/learner.ts");
const { createLearnerPipeline } = await import("../src/agent/subagents/learner.ts");
const { learnerProfileSection } = await import("../src/agent/teacher-agent.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { learnerStore } = await import("../src/store/learner.ts");

const fb = (over: Partial<ExplanationFeedback>): ExplanationFeedback => ({ id: `fb_${Math.random()}`, at: "2026-10-27T10:00:00Z", chatId: "c1", messageId: "m1", landed: false, reasons: [], ...over });
const entry = (over: Partial<LearnerEntry>): LearnerEntry => ({ id: "le_1", at: "2026-10-27T10:00:00Z", kind: "preference", statement: "s", confidence: "medium", evidence: [{ chatId: "c1" }], ...over });

describe("learner profile (pure)", () => {
	it("pairs a miss with the later explanation that landed, per chat, earliest miss first", () => {
		const pairs = explanationPairs([
			fb({ messageId: "a", reasons: ["notation"], note: "indices please", at: "2026-10-27T10:00:00Z" }),
			fb({ messageId: "b", at: "2026-10-27T10:01:00Z" }),
			fb({ messageId: "x", chatId: "c2", at: "2026-10-27T10:02:00Z" }),
			fb({ messageId: "c", landed: true, at: "2026-10-27T10:03:00Z" }),
		]);
		assert.deepEqual(pairs, [{ chatId: "c1", firstMessageId: "a", likedMessageId: "c", reasons: ["notation"], note: "indices please" }]);
		assert.deepEqual(explanationPairs([fb({ messageId: "a" }), fb({ messageId: "a", landed: true, at: "2026-10-27T11:00:00Z" })]), [], "a message cannot pair with itself");
	});

	it("drops superseded entries and summarizes newest first, flagging stale fluency", () => {
		const entries = [
			entry({ id: "old", kind: "fluency", statement: "slow with index notation", at: "2026-08-01T00:00:00Z" }),
			entry({ id: "new", kind: "fluency", statement: "reads index notation fluently", supersedes: "old", at: "2026-08-02T00:00:00Z" }),
			entry({ id: "p", kind: "preference", topic: "lensing", statement: "start from ray optics" }),
		];
		assert.deepEqual(liveEntries(entries).map((e) => e.id), ["new", "p"]);
		const summary = profileSummary(entries, Date.parse("2026-10-27T00:00:00Z"));
		assert.match(summary, /### How they like ideas framed\n- \*\*lensing:\*\* start from ray optics/);
		assert.match(summary, /reads index notation fluently _\(2026-08-02, medium confidence, not recent\)_/);
		assert.doesNotMatch(summary, /slow with index notation/);
		assert.equal(profileSummary([]), "");
	});

	it("reports only misses the teacher has not answered yet", () => {
		const feedback = [fb({ messageId: "a", reasons: ["skipped-step"], at: "2026-10-27T10:05:00Z" }), fb({ messageId: "b", at: "2026-10-27T09:00:00Z" })];
		const note = pendingFeedbackNote(feedback, "c1", Date.parse("2026-10-27T10:00:00Z"), (id) => `text of ${id}`);
		assert.match(note, /"text of a…" did not land \(skipped a step\)/);
		assert.doesNotMatch(note, /text of b/);
		assert.equal(pendingFeedbackNote(feedback, "c1", Date.parse("2026-10-27T11:00:00Z"), () => ""), "");
	});

	it("puts the profile in the system prompt, with the re-plan rule only for the teacher", () => {
		assert.equal(learnerProfileSection("teacher", ""), "");
		assert.match(learnerProfileSection("teacher", "- x"), /# The learner profile[\s\S]*revise the plan with `plan_init`[\s\S]*- x/);
		assert.doesNotMatch(learnerProfileSection("prober", "- x"), /plan_init/);
	});
});

function memoryLearnerStore(feedback: ExplanationFeedback[] = []) {
	const entries: LearnerEntry[] = [];
	const examples: { slug: string; markdown: string }[] = [];
	let state: LearnerPipelineState = { chats: {}, pairs: [] };
	const store: LearnerStore = {
		readEntries: () => [...entries],
		appendEntries: (e) => void entries.push(...e),
		readFeedback: () => [...feedback],
		appendFeedback: (f) => void feedback.push(f),
		readState: () => structuredClone(state),
		writeState: (s) => void (state = structuredClone(s)),
		writeExample: (slug, markdown) => (examples.push({ slug, markdown }), slug),
		examplesDir: () => "/nonexistent",
	};
	return { store, entries, examples, state: () => state };
}

const record = {
	id: "c1",
	messages: [
		{ id: "u1", role: "user", content: "Why is the Wiener filter biased?", timestamp: 1 },
		{ id: "a1", role: "assistant", content: [{ type: "text", text: "The Wiener filter is W = S(S+N)^-1." }], timestamp: 2 },
		{ id: "u2", role: "user", content: "I don't see where that comes from.", timestamp: 3 },
		{ id: "a2", role: "assistant", content: [{ type: "text", text: "Start from ŝ = Σ wᵢ dᵢ with dᵢ = aᵢ s + nᵢ …" }], timestamp: 4 },
	],
};
const chats = { getChat: (id: string) => (id === "c1" ? record : null) } as unknown as ChatStore;

function scripted(steps: FauxResponseStep[]) {
	const faux = createFauxCore({});
	faux.setResponses(steps);
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}
const submit = (name: string, input: unknown) => () => fauxAssistantMessage([fauxToolCall(name, input as ToolCall["arguments"])], { stopReason: "toolUse" });

describe("learner pipeline", () => {
	it("models new messages (retrying a made-up message id) and reviews a first-vs-liked pair", async () => {
		const feedback = [
			fb({ messageId: "a1", reasons: ["starting-point"], at: "2026-10-27T10:00:00Z" }),
			fb({ messageId: "a2", landed: true, at: "2026-10-27T10:05:00Z" }),
		];
		const mem = memoryLearnerStore(feedback);
		const modeler = scripted([
			submit("submit_profile_entries", { entries: [{ kind: "knowledge", statement: "x", confidence: "low", messageIds: ["ghost"] }] }),
			submit("submit_profile_entries", { entries: [{ kind: "misconception", topic: "Wiener filter", statement: "expects the filter to be unbiased", confidence: "medium", messageIds: ["u1"] }] }),
		]);
		const reviewer = scripted([
			submit("submit_style", {
				preferences: [{ topic: "estimators", statement: "start from the familiar weighted sum, then add the criterion", confidence: "medium" }],
				example: { slug: "Wiener: from weighted sums", title: "Wiener filter from weighted sums", lesson: "Start from a weighted sum.", generic: "W = S(S+N)^-1.", preferred: "ŝ = Σ wᵢ dᵢ …", teachingLesson: "The familiar sum came first." },
			}),
		]);
		const pipeline = createLearnerPipeline({ chatStore: chats, learnerStore: mem.store, engineFor: (role) => (role === "learnerModeler" ? modeler : role === "explanationReviewer" ? reviewer : undefined) });

		assert.deepEqual(await pipeline.runLearnerUpdate("c1"), { entries: 2, examples: 1 });
		const [misconception, preference] = mem.entries;
		assert.equal(misconception!.kind, "misconception");
		assert.deepEqual(misconception!.evidence, [{ chatId: "c1", messageId: "u1" }]);
		assert.equal(preference!.kind, "preference");
		assert.deepEqual(preference!.evidence.map((e) => e.messageId), ["a1", "a2"]);
		assert.match(mem.examples[0]!.markdown, /^# Wiener filter from weighted sums\n\nLesson: Start from a weighted sum\.\n\n## Generic answer/);
		assert.equal(mem.state().chats.c1, 4, "the cursor advances past the modelled messages");
		assert.equal(mem.state().pairs.length, 1);

		assert.deepEqual(await pipeline.runLearnerUpdate("c1"), { entries: 0, examples: 0 }, "nothing new: no model call, no duplicate review");
	});

	it("skips without an engine and leaves the cursor for the next run", async () => {
		const mem = memoryLearnerStore();
		const pipeline = createLearnerPipeline({ chatStore: chats, learnerStore: mem.store, engineFor: () => undefined });
		assert.deepEqual(await pipeline.runLearnerUpdate("c1"), { entries: 0, examples: 0 });
		assert.equal(mem.state().chats.c1, undefined);
	});
});

after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

describe("feedback route", () => {
	it("stores a verdict on a teacher message and rejects bad input", async () => {
		const route = await import("../app/api/chats/[id]/feedback/route.ts");
		const chat = chatStore.createChat("Test: feedback");
		chatStore.saveMessages(chat.id, record.messages as never);
		const post = (body: unknown) => route.POST(new Request("http://test", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: chat.id }) });

		assert.equal((await post({ messageId: "a1", landed: false, reasons: ["notation"], note: " use indices " })).status, 200);
		assert.equal((await post({ messageId: "u1", landed: true })).status, 400, "a learner message is not an explanation");
		assert.equal((await post({ messageId: "a1", landed: false, reasons: ["bogus"] })).status, 400);
		assert.equal((await post({ messageId: "a1" })).status, 400);
		const stored = learnerStore.readFeedback().filter((f) => f.chatId === chat.id);
		assert.equal(stored.length, 1);
		assert.deepEqual([stored[0]!.reasons, stored[0]!.note], [["notation"], "use indices"]);
	});
});
