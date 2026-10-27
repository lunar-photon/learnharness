/**
 * The tap formats for derivations and code (owner, 2026-10-27): authoring
 * validation, ordered grading, the fill_blank slot, and real taps through
 * the dock (order → Done → How sure? → answer).
 */
import React, { act } from "react";
(globalThis as { React?: typeof React }).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestionDock } from "../components/question-dock.tsx";
import { buildAnswer, fillBlankLine, quizInputProblems, type QuestionAnswerData, type QuestionData } from "../src/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });

const opts = (...labels: string[]) => labels.map((label, i) => ({ label, value: `s${i + 1}` }));

describe("tap format authoring", () => {
	it("fill_blank needs lines with exactly one blank", () => {
		const base = { options: opts("K", "K^T"), correctAnswer: "s1", format: "fill_blank" };
		assert.match(quizInputProblems(base).join(" "), /needs `lines`/);
		assert.match(quizInputProblems({ ...base, lines: ["$$ C = d - ___ C $$", "and ___"] }).join(" "), /exactly one ___/);
		assert.deepEqual(quizInputProblems({ ...base, lines: ["$$ C = d - ___ C $$"] }), []);
	});

	it("order needs correctAnswer to restate every option in the authored order", () => {
		const base = { options: opts("a", "b", "c"), format: "order" };
		assert.deepEqual(quizInputProblems({ ...base, correctAnswer: ["s1", "s2", "s3"] }), []);
		assert.match(quizInputProblems({ ...base, correctAnswer: ["s2", "s1", "s3"] }).join(" "), /same order/);
		assert.match(quizInputProblems({ ...base, correctAnswer: "s1" }).join(" "), /same order/);
	});

	it("plain choice is unchanged", () => {
		assert.deepEqual(quizInputProblems({ options: opts("a", "b"), correctAnswer: "s2" }), []);
	});
});

describe("order grading", () => {
	const qd: QuestionData = {
		id: "o1", kind: "quiz", format: "order", question: "Order the derivation.", mode: "single-select",
		// display order is shuffled; the key is the authored sequence by display index
		options: [{ label: "c", value: "s3" }, { label: "a", value: "s1" }, { label: "b", value: "s2" }],
		correctIndices: [2, 3, 1], createdAt: "fixture",
	};
	it("the right sequence is correct and keeps the tapped order", () => {
		const a = buildAnswer(qd, { values: ["s1", "s2", "s3"], confidence: 90 });
		assert.equal(a.correct, true);
		assert.deepEqual(a.answers.map((x) => x.label), ["a", "b", "c"]);
		assert.equal(a.format, "order");
	});
	it("the same lines in another order are wrong", () => {
		assert.equal(buildAnswer(qd, { values: ["s2", "s1", "s3"] }).correct, false);
	});
});

describe("fillBlankLine", () => {
	it("boxes the slot inside maths, plain text in code, bold in prose", () => {
		assert.equal(fillBlankLine("$$ C = d - ___ C $$", undefined), "$$ C = d - \\boxed{\\;?\\;} C $$");
		assert.equal(fillBlankLine("$$ C = d - ___ C $$", "$\\mathbf K$"), "$$ C = d - \\boxed{\\mathbf K} C $$");
		assert.equal(fillBlankLine("for i in range(___):", "`len(xs)`", "python"), "for i in range(len(xs)):");
		assert.equal(fillBlankLine("cost $$x$$ ___", "a$1b"), "cost $$x$$ \\boxed{a$1b}", "a $ in the label is not a replace pattern");
		assert.equal(fillBlankLine("The ___ converges", "iteration"), "The **iteration** converges");
	});
});

describe("tap formats in the dock", () => {
	it("order: tap the lines, Done, How sure? sends them in the tapped order", async () => {
		const input = {
			type: "check", nodeId: "n1", question: "Put the steps in order.", format: "order", explanation: "Linear, rearrange, iterate.",
			options: opts("linear in C", "rearrange", "iterate"),
			correctAnswer: ["s1", "s2", "s3"],
		};
		let answer: QuestionAnswerData | undefined;
		const host = document.createElement("div"); document.body.append(host);
		const root = createRoot(host);
		try {
			await act(async () => root.render(<QuestionDock toolName="quiz" toolCallId="order_fixture" input={input as never} expanded dictationClaim={false} onExpand={() => {}} onSubmit={(a) => { answer = a; }} />));
			assert.ok(host.querySelector('[data-testid="format-order"]'), "the order card renders");
			for (const text of ["linear in C", "rearrange", "iterate"]) {
				const tile = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent?.includes(text));
				assert.ok(tile, `tile "${text}" is still unplaced`);
				await act(async () => tile!.click());
			}
			assert.match(host.querySelector('[aria-label="Your order"]')!.textContent ?? "", /1linear in C2rearrange3iterate/, "placed in tap order");
			const done = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Done")!;
			assert.equal(done.disabled, false, "Done once every line is placed");
			await act(async () => done.click());
			await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="sure-4"]')!.click());
			assert.ok(answer);
			assert.equal(answer.answers.length, 3);
			assert.equal(answer.confidence, 100);
			assert.equal(answer.correct, true, "tapped in the authored order");
			assert.deepEqual(answer.answers.map((a) => a.label), ["linear in C", "rearrange", "iterate"]);
		} finally {
			await act(async () => root.unmount()); host.remove();
		}
	});

	it("next_step shows the lines and an empty slot; spot_error puts the options in the card", () => {
		const next = renderToStaticMarkup(
			<QuestionDock toolName="quiz" toolCallId="ns" expanded onExpand={() => {}} onSubmit={() => {}}
				input={{ type: "check", nodeId: "n1", question: "What comes next?", format: "next_step", lines: ["x = 1", "y = x + 1"], language: "python", explanation: "e", options: opts("print(y)", "print(x)"), correctAnswer: "s1" } as never} />,
		);
		assert.ok(next.includes('data-testid="format-next_step"'));
		assert.ok(next.includes('data-testid="next-step-slot"'));
		assert.match(next, /font-mono[^>]*>x = 1</, "code lines render monospaced");
		assert.match(next, /tap the next line/);
		const spot = renderToStaticMarkup(
			<QuestionDock toolName="quiz" toolCallId="se" expanded onExpand={() => {}} onSubmit={() => {}}
				input={{ type: "check", nodeId: "n1", question: "Which line is wrong?", format: "spot_error", language: "python", explanation: "e", options: opts("a = 1", "b = a / 0", "    c = b"), correctAnswer: "s2" } as never} />,
		);
		const card = spot.slice(spot.indexOf('data-testid="format-spot_error"'));
		assert.ok(card.indexOf("a = 1") < card.indexOf("b = a / 0") && card.indexOf("b = a / 0") < card.indexOf("c = b"), "the worked lines keep their order");
		assert.ok(card.includes(">    c = b<"), "code keeps its indentation");
	});
});
