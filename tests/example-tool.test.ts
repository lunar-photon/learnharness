/**
 * The teacher's example library (src/agent/prompts/examples/): the tool's
 * description indexes every example by id, title and lesson; a call returns
 * the full text; an unknown id is an error naming the valid ones. The
 * presentation guide fragment composes into the teacher prompt only.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exampleTool, listExamples } from "../src/agent/tools/example.ts";
import { createTeacherTools } from "../src/agent/tools.ts";
import { composeInstructions } from "../src/agent/teacher-agent.ts";

describe("example library", () => {
	it("indexes the owner's seven examples with a title and a lesson each", () => {
		// The learner's own `mine-` examples live in their data dir and vary; the built-in seven are fixed.
		const examples = listExamples().filter((e) => !e.id.startsWith("mine-"));
		assert.equal(examples.length, 7);
		for (const e of examples) {
			assert.ok(e.title && e.lesson, `${e.id} has a title and a Lesson: line`);
		}
		const tool = exampleTool();
		for (const e of examples) assert.ok(tool.description.includes(`\`${e.id}\``), `${e.id} is listed in the description`);
	});

	it("returns an example in full and rejects an unknown id", async () => {
		const tool = exampleTool();
		const result = await tool.execute("call_1", { id: "wiener-filter-unbiasedness" });
		const text = result.content.map((c) => ("text" in c ? c.text : "")).join("");
		assert.match(text, /## Preferred construction/);
		assert.match(text, /\\sum_i w_i a_i = 1/);
		const bad = await tool.execute("call_2", { id: "nope" }).then((r) => r, (e: Error) => e);
		const badText = bad instanceof Error ? bad.message : bad.content.map((c) => ("text" in c ? c.text : "")).join("");
		assert.match(badText, /No example "nope"/);
	});

	it("is a teacher tool, and the presentation guide is in the teacher prompt but not the prober's", () => {
		const tools = createTeacherTools({ chatId: "c", chatStore: {} as never, jobStore: {} as never, spawn: (() => undefined) as never });
		assert.ok("example" in tools);
		assert.match(composeInstructions("teacher"), /Presentation — build each explanation on what the learner already knows/);
		assert.doesNotMatch(composeInstructions("prober"), /Presentation — build each explanation/);
	});
});
