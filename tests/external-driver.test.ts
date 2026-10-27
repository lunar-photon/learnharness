/**
 * The external-agent driver (docs/agent-driver-plan.md): a terminal agent
 * answers parked model requests over /api/driver/*. Pins the engine's
 * park → pull → reply round trip, thread deltas, abort, reply validation,
 * and one real teacher turn through handleChatRequest on provider
 * "external" (zero tokens — this test plays the agent).
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { normalizeContext, type Message } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { EXTERNAL_MODEL_ID, EXTERNAL_PROVIDER, driverNext, driverRefetch, driverRespond, externalModel, externalStream } from "../src/agent/external-engine.ts";
import { piEngineForSpec } from "../src/agent/models.ts";
import { createTeacherAgent } from "../src/agent/teacher-agent.ts";
import { handleChatRequest } from "../src/server/chat-handler.ts";
import { runningTurn } from "../src/server/turn-runs.ts";
import { chatStore } from "../src/store/chats.ts";
import { danglingQuestionOf } from "../src/core/native-messages.ts";
import { PATHS } from "../config.ts";

const model = externalModel(EXTERNAL_MODEL_ID)!;
const tool = { name: "quiz", description: "Ask a graded question.", parameters: Type.Object({ question: Type.String() }) };
const user = (text: string): Message => ({ role: "user", content: text, timestamp: Date.now() });

describe("external engine", () => {
	it("parks a request, delivers it once, and turns the reply into a finished assistant message", async () => {
		const stream = externalStream({ role: "teacher", chatId: "chat_rt" })(model, normalizeContext({ systemPrompt: "You teach.", tools: [tool], messages: [user("teach me lensing")] }));
		const request = await driverNext(1000);
		assert.ok(request, "the parked request is delivered");
		assert.equal(request.role, "teacher");
		assert.equal(request.chatId, "chat_rt");
		assert.equal(request.systemPrompt, "You teach.");
		assert.deepEqual(request.tools?.map((t) => t.name), ["quiz"]);
		assert.deepEqual(request.messages, [{ role: "user", text: "teach me lensing" }]);
		assert.equal(await driverNext(50), null, "a claimed request is not handed out twice");

		assert.deepEqual(driverRespond({ requestId: request.requestId, text: "Start from ray optics.", toolCalls: [{ name: "quiz", arguments: { question: "What bends the ray?" } }] }), { ok: true });
		const message = await stream.result();
		assert.equal(message.stopReason, "toolUse");
		assert.equal(message.provider, EXTERNAL_PROVIDER);
		assert.equal(message.content[0]?.type, "text");
		const call = message.content[1];
		assert.ok(call?.type === "toolCall" && call.name === "quiz" && call.id.startsWith("call_"));
		assert.deepEqual(call.arguments, { question: "What bends the ray?" });
		assert.equal(driverRespond({ requestId: request.requestId, text: "again" }).ok, false, "a settled request cannot be answered twice");
	});

	it("sends only the new messages on a growing thread, and everything on a full re-fetch", async () => {
		const label = { role: "teacher", chatId: "chat_delta" };
		const first = [user("what is a connection?")];
		const s1 = externalStream(label)(model, normalizeContext({ systemPrompt: "P", tools: [tool], messages: first }));
		const r1 = (await driverNext(1000))!;
		driverRespond({ requestId: r1.requestId, toolCalls: [{ name: "quiz", arguments: { question: "q" } }] });
		const reply = await s1.result();
		const call = reply.content[0] as { id: string };

		const grown: Message[] = [...first, reply, { role: "toolResult", toolCallId: call.id, toolName: "quiz", content: [{ type: "text", text: "learner chose B" }], isError: false, timestamp: Date.now() }];
		const s2 = externalStream(label)(model, normalizeContext({ systemPrompt: "P", tools: [tool], messages: grown }));
		const r2 = (await driverNext(1000))!;
		assert.equal(r2.prior, 1);
		assert.equal(r2.previousId, r1.requestId);
		assert.equal(r2.systemPrompt, null, "unchanged prompt is not resent");
		assert.equal(r2.promptFrom, r1.requestId);
		assert.equal(r2.tools, null, "unchanged tools are not resent");
		assert.deepEqual(r2.messages.map((m) => m.role), ["assistant", "toolResult"]);

		const full = driverRefetch(r2.requestId, true)!;
		assert.equal(full.prior, 0);
		assert.equal(full.systemPrompt, "P");
		assert.equal(full.messages.length, 3);
		driverRespond({ requestId: r2.requestId, text: "B is right." });
		assert.equal((await s2.result()).stopReason, "stop");
	});

	it("elides a role's unchanged prompt and tools across threads", async () => {
		const ctx = (text: string) => normalizeContext({ systemPrompt: "Extract PYQs.", tools: [tool], messages: [user(text)] });
		const s1 = externalStream({ role: "pyqExtractor" })(model, ctx("pages 1-3"));
		const r1 = (await driverNext(1000))!;
		driverRespond({ requestId: r1.requestId, text: "ok" });
		await s1.result();
		const s2 = externalStream({ role: "pyqExtractor" })(model, ctx("pages 4-6"));
		const r2 = (await driverNext(1000))!;
		assert.equal(r1.systemPrompt, "Extract PYQs.");
		assert.equal(r2.prior, 0, "a new chunk is a new thread: its messages go out whole");
		assert.equal(r2.systemPrompt, null);
		assert.equal(r2.tools, null);
		assert.equal(r2.promptFrom, r1.requestId);
		driverRespond({ requestId: r2.requestId, text: "ok" });
		await s2.result();
	});

	it("an abort settles the stream and frees the request", async () => {
		const controller = new AbortController();
		const stream = externalStream({ role: "research" })(model, normalizeContext({ messages: [user("find sources")] }), { signal: controller.signal });
		const request = (await driverNext(1000))!;
		controller.abort();
		assert.equal((await stream.result()).stopReason, "aborted");
		const late = driverRespond({ requestId: request.requestId, text: "too late" });
		assert.ok(!late.ok && late.status === 409);
	});

	it("rejects empty replies and malformed tool calls without settling", async () => {
		const stream = externalStream({ role: "teacher" })(model, normalizeContext({ messages: [user("hi")] }));
		const request = (await driverNext(1000))!;
		const empty = driverRespond({ requestId: request.requestId });
		assert.ok(!empty.ok && empty.status === 400);
		const bad = driverRespond({ requestId: request.requestId, toolCalls: [{ name: "quiz", arguments: [] as unknown as object }] });
		assert.ok(!bad.ok && bad.status === 400);
		driverRespond({ requestId: request.requestId, text: "Hello." });
		assert.equal((await stream.result()).stopReason, "stop");
	});
});

const createdChats: string[] = [];
after(() => {
	for (const id of createdChats) {
		try { fs.unlinkSync(path.join(PATHS.chats, `${id}.json`)); } catch { /* already gone */ }
	}
});

describe("external provider through the turn pipeline", () => {
	it("a teacher turn on external/agent waits for the agent, and its quiz becomes the pending question", { timeout: 15000 }, async () => {
		const chat = chatStore.createChat("Test: external driver");
		createdChats.push(chat.id);
		chatStore.saveSettings(chat.id, { model: { provider: EXTERNAL_PROVIDER, id: EXTERNAL_MODEL_ID } });
		const engine = piEngineForSpec({ provider: EXTERNAL_PROVIDER, id: EXTERNAL_MODEL_ID }, true, undefined, { role: "teacher", chatId: chat.id });
		const req = new Request("http://test/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: chat.id, input: { type: "text", text: "Teach me the Wiener filter" } }) });

		const ack = handleChatRequest(req, (opts) => createTeacherAgent(undefined, { engine, messages: opts.messages }));
		const request = (await driverNext(5000))!;
		assert.ok(request, "the turn parked a request for the agent");
		assert.equal(request.chatId, chat.id);
		assert.ok(request.tools?.some((t) => t.name === "quiz"), "the teacher's own tool schemas travel with the request");
		assert.ok(request.messages.some((m) => m.role === "user" && m.text.includes("Wiener")));
		const quiz = { question: "Which weights make ŝ unbiased?", type: "check", nodeId: "wiener", options: [{ label: "Σ wᵢaᵢ = 1" }, { label: "Σ wᵢ = 0" }], correctAnswer: "Σ wᵢaᵢ = 1", explanation: "⟨ŝ⟩ = s Σ wᵢaᵢ." };
		assert.deepEqual(driverRespond({ requestId: request.requestId, text: "Start from a weighted sum of the data.", toolCalls: [{ name: "quiz", arguments: quiz }] }), { ok: true });

		const res = await ack;
		assert.equal(res.status, 200, await res.clone().text());
		const handle = runningTurn(chat.id);
		if (handle) await new Response(handle.subscribe()).text();
		const followUp = await driverNext(100);
		assert.equal(followUp, null, `no second request (a rejected tool call would ask again): ${JSON.stringify(followUp?.messages)}`);
		const record = chatStore.getChat(chat.id)!;
		const pending = danglingQuestionOf(record.messages);
		assert.ok(pending, "the agent's quiz is the learner's pending question");
	});
});
