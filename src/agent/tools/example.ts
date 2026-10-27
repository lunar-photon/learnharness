import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { PATHS } from "../../../config.ts";
import { serverExecute } from "../tool-execute.ts";

/** The learner's example library (src/agent/prompts/examples/README.md):
 *  generic answer vs preferred construction, one file per example. */
const EXAMPLES_DIR = path.join(PATHS.root, "src", "agent", "prompts", "examples");
/** Pairs the explanation reviewer wrote up from the learner's own sessions. */
const LEARNER_EXAMPLES_DIR = path.join(PATHS.learner, "examples");

interface ExampleEntry { id: string; title: string; lesson: string; file: string }

export function listExamples(dirs: readonly string[] = [EXAMPLES_DIR, LEARNER_EXAMPLES_DIR]): ExampleEntry[] {
	return dirs.flatMap((dir, i) => readDir(dir, i === 0 ? "" : "mine-"));
}

function readDir(dir: string, prefix: string): ExampleEntry[] {
	let files: string[];
	try { files = fs.readdirSync(dir).filter((f) => /^\d+-[\w-]+\.md$/.test(f)).sort(); }
	catch { return []; }
	return files.map((file) => {
		const text = fs.readFileSync(path.join(dir, file), "utf-8");
		return {
			id: prefix + file.replace(/^\d+-/, "").replace(/\.md$/, ""),
			title: /^# (.+)$/m.exec(text)?.[1]?.trim() ?? file,
			lesson: /^Lesson: (.+)$/m.exec(text)?.[1]?.trim() ?? "",
			file: path.join(dir, file),
		};
	});
}

const exampleInput = Type.Object({
	id: Type.String({ description: "The example id from the list in this tool's description." }),
});

/** Built per agent construction, so the listed index matches the files on disk. */
export function exampleTool(dirs?: readonly string[]): AgentTool<typeof exampleInput> {
	const examples = listExamples(dirs);
	const index = examples.map((e) => `- \`${e.id}\` — ${e.title}: ${e.lesson}`).join("\n");
	return {
		name: "example",
		label: "example",
		description:
			"Worked examples of how THIS learner wants ideas framed: a generic answer, the construction they prefer, and the " +
			"teaching lesson between them. Before a substantial explanation, fetch the one or two whose lesson is closest to " +
			"what you are about to explain and follow their reasoning process, not their wording or topic. Ids starting `mine-` " +
			"come from this learner's own sessions (a first explanation that did not land vs the one that did).\n\nAvailable:\n" +
			(index || "(none yet)"),
		parameters: exampleInput,
		execute: serverExecute("example", exampleInput, ({ id }) => {
			const entry = examples.find((e) => e.id === id);
			if (!entry) throw new Error(`No example "${id}". Available: ${examples.map((e) => e.id).join(", ")}`);
			return fs.readFileSync(entry.file, "utf-8");
		}),
	};
}
