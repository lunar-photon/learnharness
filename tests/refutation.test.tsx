/**
 * Refutation support (owner, 2026-10-28): each wrong option may carry the
 * misconception behind it. It is hidden before the answer, comes back to the
 * teacher with a wrong pick, and shows on the answered card as "the trap".
 */
import React from "react";
(globalThis as { React?: typeof React }).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Value } from "typebox/value";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionDock } from "../components/question-dock.tsx";
import { AnsweredCard } from "../components/answered-card.tsx";
import { buildAnswer, compactAnswerForModel, quizInputSchema, type QuestionData } from "../src/core/index.ts";

const TRAP = "Thinking N1 is extra noise, independent of the lensing signal.";
const input = {
	type: "check", nodeId: "n1", question: "How does N1 depend on the lensing spectrum?", explanation: "N1 is a lens exchange routed across the estimators.",
	options: [
		{ label: "Linearly, through K", value: "lin" },
		{ label: "Not at all", value: "none", misconception: TRAP },
		{ label: "Quadratically", value: "quad" },
	],
	correctAnswer: "lin",
};
const qd: QuestionData = {
	id: "t", kind: "quiz", question: input.question, mode: "single-select", createdAt: "x", explanation: input.explanation,
	options: input.options.map((o) => ({ ...o })), correctIndices: [1],
};

describe("the misconception on a wrong option", () => {
	it("is part of the teach quiz schema", () => {
		assert.ok(Value.Check(quizInputSchema, input));
	});

	it("rides a wrong answer back to the teacher, and stays out of a right one", () => {
		const wrong = buildAnswer(qd, { values: ["none"], confidence: 100 });
		assert.equal(wrong.trap, TRAP);
		assert.equal(compactAnswerForModel(wrong).misconception, TRAP);
		const right = buildAnswer(qd, { values: ["lin"], confidence: 100 });
		assert.equal(right.trap, undefined);
		assert.equal(compactAnswerForModel(right).misconception, undefined);
		assert.equal(buildAnswer(qd, { values: ["quad"] }).trap, undefined, "a wrong option without one adds nothing");
	});

	it("is hidden before the answer and shown as the trap after a miss", () => {
		const open = renderToStaticMarkup(<QuestionDock toolName="quiz" toolCallId="t" input={input as never} expanded onExpand={() => {}} onSubmit={() => {}} />);
		assert.ok(!open.includes("independent of the lensing signal"), "never shown before the answer");
		const card = renderToStaticMarkup(<AnsweredCard answer={buildAnswer(qd, { values: ["none"] })} />);
		assert.match(card, /data-testid="answered-trap"/);
		assert.match(card, /The trap:/);
		assert.ok(!renderToStaticMarkup(<AnsweredCard answer={buildAnswer(qd, { values: ["lin"] })} />).includes("answered-trap"));
	});
});
