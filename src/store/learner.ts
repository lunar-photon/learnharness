import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { FEEDBACK_REASONS, LEARNER_ENTRY_KINDS, type ExplanationFeedback, type LearnerEntry } from "../core/contracts/learner.ts";
import type { LearnerPipelineState, LearnerStore } from "../core/ports.ts";

/** The fs adapter for the learner profile (core/ports.ts LearnerStore):
 *  append-only JSONL under data/learner/, corrupt-line tolerant reads with
 *  strict shape guards (the graph ledgers' idiom). */

const file = (name: string) => path.join(PATHS.learner, name);

function readLines(name: string): unknown[] {
	let raw: string;
	try { raw = fs.readFileSync(file(name), "utf-8"); } catch { return []; }
	return raw.split("\n").flatMap((line) => {
		if (!line.trim()) return [];
		try { return [JSON.parse(line)]; } catch { return []; } // a torn append must not take the profile down
	});
}

function append(name: string, records: readonly unknown[]): void {
	if (!records.length) return;
	fs.mkdirSync(PATHS.learner, { recursive: true });
	fs.appendFileSync(file(name), records.map((r) => `${JSON.stringify(r)}\n`).join(""), "utf-8");
}

const obj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function isEntry(v: unknown): v is LearnerEntry {
	return obj(v) && str(v.id) && str(v.at) && str(v.statement)
		&& (LEARNER_ENTRY_KINDS as readonly unknown[]).includes(v.kind)
		&& ["low", "medium", "high"].includes(v.confidence as string)
		&& Array.isArray(v.evidence) && v.evidence.every((e) => obj(e) && str(e.chatId));
}

function isFeedback(v: unknown): v is ExplanationFeedback {
	return obj(v) && str(v.id) && str(v.at) && str(v.chatId) && str(v.messageId) && typeof v.landed === "boolean"
		&& Array.isArray(v.reasons) && v.reasons.every((r) => (FEEDBACK_REASONS as readonly unknown[]).includes(r));
}

export const learnerStore: LearnerStore = {
	readEntries: () => readLines("profile.jsonl").filter(isEntry),
	appendEntries: (entries) => append("profile.jsonl", entries),
	readFeedback: () => readLines("feedback.jsonl").filter(isFeedback),
	appendFeedback: (feedback) => append("feedback.jsonl", [feedback]),
	readState(): LearnerPipelineState {
		try {
			const s = JSON.parse(fs.readFileSync(file("state.json"), "utf-8"));
			return { chats: obj(s.chats) ? (s.chats as Record<string, number>) : {}, pairs: Array.isArray(s.pairs) ? s.pairs.filter(str) : [] };
		} catch {
			return { chats: {}, pairs: [] };
		}
	},
	writeState(state) {
		fs.mkdirSync(PATHS.learner, { recursive: true });
		fs.writeFileSync(file("state.json"), JSON.stringify(state, null, "\t"), "utf-8");
	},
	writeExample(slug, markdown) {
		const dir = file("examples");
		fs.mkdirSync(dir, { recursive: true });
		const clean = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "example";
		const n = fs.readdirSync(dir).filter((f) => /^\d+-/.test(f)).length + 1;
		fs.writeFileSync(path.join(dir, `${String(n).padStart(2, "0")}-${clean}.md`), markdown, "utf-8");
		return clean;
	},
	examplesDir: () => file("examples"),
};
