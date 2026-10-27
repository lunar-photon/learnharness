/**
 * Doubts during a lesson (core/input-events.ts, shared/20-question-tools.md):
 * text sent while a question is open pauses it (closed like a dismissal, so
 * never graded), tells the model to re-pose it, and the doubt follows as the
 * learner's message. Quick replies and the doubt line render.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inputAppends } from "../src/core/input-events.ts";
import { compactAnswerForModel, doubtAnswer } from "../src/core/question-core.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import { DoubtLine } from "../components/doubt-line.tsx";
import { ChatActionsContext } from "../components/chat.tsx";
import { ExplanationFeedback } from "../components/explanation-feedback.tsx";

const openQuiz: LhMessage[] = [
	{ id: "u1", role: "user", content: "teach me", timestamp: 1 } as LhMessage,
	{ id: "a1", role: "assistant", content: [{ type: "toolCall", id: "call-q", name: "quiz", arguments: { question: "Which Γ is nonzero?", options: [{ label: "a" }, { label: "b" }] } }], timestamp: 2 } as unknown as LhMessage,
];

describe("doubts while a question is open", () => {
	it("pause the question, then carry the doubt as the learner's message", () => {
		const appended = inputAppends({ messages: openQuiz }, { type: "text", text: "why is Γ^r_θθ negative?" });
		assert.equal(appended.length, 2);
		const [result, doubt] = appended as unknown as [{ role: string; toolCallId: string; details: { doubt?: boolean; dismissed?: boolean; questionText: string }; content: { text: string }[] }, { role: string; content: string }];
		assert.equal(result.role, "toolResult");
		assert.equal(result.toolCallId, "call-q");
		assert.deepEqual([result.details.doubt, result.details.dismissed, result.details.questionText], [true, true, "Which Γ is nonzero?"]);
		assert.match(result.content[0]!.text, /pausedForDoubt/);
		assert.equal(doubt.role, "user");
		assert.equal(doubt.content, "why is Γ^r_θθ negative?");
	});

	it("leave plain messages alone when nothing is open", () => {
		const done = [...openQuiz, { id: "r", role: "toolResult", toolCallId: "call-q", toolName: "quiz", content: [], isError: false, timestamp: 3 } as unknown as LhMessage];
		assert.deepEqual(inputAppends({ messages: done }, { type: "text", text: "next" }).map((m) => (m as { role: string }).role), ["user"]);
	});

	it("are never graded, and tell the model to answer then re-pose", () => {
		const model = compactAnswerForModel(doubtAnswer("quiz", "Which Γ?"));
		assert.equal(model.pausedForDoubt, true);
		assert.match(String(model.instruction), /pose the check again/);
		assert.equal(model.correct, undefined);
	});
});

describe("doubt and quick-reply controls", () => {
	it("render an accessible doubt line and the quick replies", () => {
		const line = renderToStaticMarkup(<DoubtLine onAsk={() => {}} />);
		assert.match(line, /<label[^>]*for="doubt-input"/);
		assert.match(line, /Stuck\? Ask a doubt/);
		const replies = renderToStaticMarkup(
			<ChatActionsContext.Provider value={{ chatId: "c", syncFromServer: async () => {}, sendText: () => {}, canSendText: true, openSetup: () => {} }}>
				<ExplanationFeedback messageId="m1" />
			</ChatActionsContext.Provider>,
		);
		for (const label of ["Why?", "Example", "Draw it", "Go deeper"]) assert.match(replies, new RegExp(`>${label.replace("?", "\\?")}<`));
	});
});
