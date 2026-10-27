import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import {
	getCurrentSystemPrompt,
	getCurrentTools,
	toToolDeclaration,
	type Api,
	type AssistantMessage,
	type ImageContent,
	type JsonObject,
	type Message,
	type Model,
	type StreamFunction,
	type TextContent,
	type ToolCall,
} from "@earendil-works/pi-ai";
import { nanoid } from "nanoid";

/**
 * THE EXTERNAL ENGINE (docs/agent-driver-plan.md): a terminal agent (Claude
 * Code, Codex, Gemini CLI, opencode, Antigravity) is the model. Each stream
 * call parks one REQUEST — role, current system prompt, tool declarations,
 * messages — in a process-wide queue; the agent pulls it over
 * /api/driver/next (scripts/lh-mcp.mjs) and posts the reply to
 * /api/driver/respond, which resolves the stream as if an API had answered.
 * Everything downstream (tool validation, question gates, persistence,
 * ids) is the normal pi path. Usage is zero: the agent's own subscription
 * pays, and nothing here can see it.
 */

export const EXTERNAL_PROVIDER = "external";
export const EXTERNAL_MODEL_ID = "agent";

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...ZERO_COST, total: 0 } };
/** An unclaimed request fails after this long with no agent activity. */
const UNCONNECTED_MS = 30_000;
/** Any driver call within this window counts as a connected agent. */
const ACTIVE_MS = 120_000;
const NOT_CONNECTED = "No agent is connected. In your terminal agent (Claude Code, Codex, Gemini CLI, opencode, Antigravity…), open the LearnHarness folder and say: launch learnharness.";

export function externalModel(id: string): Model<Api> | undefined {
	if (id !== EXTERNAL_MODEL_ID) return undefined;
	// contextWindow is the harness-side compaction budget, not the agent's own.
	return { id, name: "Terminal agent", api: "external", provider: EXTERNAL_PROVIDER, baseUrl: "", reasoning: false, input: ["text", "image"], cost: ZERO_COST, contextWindow: 200_000, maxTokens: 64_000 };
}

/** Who the request is for: the agent routes on `role` (teacher/prober
 *  answered in person, background roles handed to sub-agents). */
export interface ExternalLabel {
	role: string;
	chatId?: string;
}

/** The agent-facing message shape: compact, thinking dropped, images as
 *  temp-file paths the agent can open with its own tools. */
export type DriverMessage =
	| { role: "system" | "user"; text: string; images?: string[] }
	| { role: "assistant"; text?: string; toolCalls?: { id: string; name: string; arguments: JsonObject }[] }
	| { role: "toolResult"; toolCallId: string; toolName: string; isError?: true; text: string; images?: string[] };

export interface DriverRequest {
	requestId: string;
	role: string;
	chatId?: string;
	/** null = unchanged since promptFrom (same role). */
	systemPrompt: string | null;
	tools: { name: string; description: string; parameters: unknown }[] | null;
	/** Messages after the `prior` ones already sent in previousId. */
	messages: DriverMessage[];
	prior: number;
	previousId?: string;
	/** The request that last carried this role's prompt and tools. */
	promptFrom?: string;
}

export interface DriverReply {
	requestId: string;
	text?: string;
	toolCalls?: { name: string; arguments: unknown }[];
}

interface Parked {
	id: string;
	label: ExternalLabel;
	thread: string;
	systemPrompt: string;
	tools: DriverRequest["tools"] & {};
	messages: DriverMessage[];
	createdAt: number;
	claimedAt?: number;
	settle: (outcome: { reply: DriverReply } | { error: string; aborted?: boolean }) => void;
}

interface ThreadState { lastId: string; sent: number }
/** What each role's agent already holds: prompts and tools repeat across threads (every PYQ chunk is its own thread). */
interface RoleState { lastId: string; promptHash: string; toolsHash: string }

interface DriverState {
	parked: Map<string, Parked>;
	waiters: Set<() => void>;
	threads: Map<string, ThreadState>;
	roles: Map<string, RoleState>;
	lastSeen: number;
	activePolls: number;
}

function state(): DriverState {
	const g = globalThis as typeof globalThis & { __lhDriver?: DriverState };
	const s = (g.__lhDriver ??= { parked: new Map(), waiters: new Set(), threads: new Map(), roles: new Map(), lastSeen: 0, activePolls: 0 });
	s.roles ??= new Map(); // a state object from before roles existed (dev hot reload)
	return s;
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

export function driverConnected(now = Date.now()): boolean {
	const s = state();
	return s.activePolls > 0 || now - s.lastSeen < ACTIVE_MS || [...s.parked.values()].some((p) => p.claimedAt);
}

function imagePath(image: ImageContent): string {
	const dir = join(tmpdir(), "learnharness-driver");
	mkdirSync(dir, { recursive: true });
	const ext = image.mimeType.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "bin";
	const file = join(dir, `${hash(image.data)}.${ext}`);
	writeFileSync(file, Buffer.from(image.data, "base64"));
	return file;
}

function textAndImages(content: string | (TextContent | ImageContent)[]): { text: string; images?: string[] } {
	if (typeof content === "string") return { text: content };
	const text = content.filter((c): c is TextContent => c.type === "text").map((c) => c.text).join("\n");
	const images = content.filter((c): c is ImageContent => c.type === "image").map(imagePath);
	return images.length ? { text, images } : { text };
}

export function toDriverMessages(messages: readonly Message[]): DriverMessage[] {
	return messages.flatMap((m): DriverMessage[] => {
		switch (m.role) {
			case "system":
				return [{ role: "system", text: typeof m.content === "string" ? m.content : m.content.map((c) => c.text).join("\n") }];
			case "user":
				return [{ role: "user", ...textAndImages(m.content) }];
			case "assistant": {
				const text = m.content.filter((c): c is TextContent => c.type === "text").map((c) => c.text).join("\n");
				const calls = m.content.filter((c): c is ToolCall => c.type === "toolCall").map((c) => ({ id: c.id, name: c.name, arguments: c.arguments }));
				return [{ role: "assistant", ...(text ? { text } : {}), ...(calls.length ? { toolCalls: calls } : {}) }];
			}
			case "toolResult":
				return [{ role: "toolResult", toolCallId: m.toolCallId, toolName: m.toolName, ...(m.isError ? { isError: true as const } : {}), ...textAndImages(m.content) }];
			default:
				return [];
		}
	});
}

/** The agent's reply as a finished assistant message. */
export function replyMessage(model: Model<Api>, reply: DriverReply): AssistantMessage {
	const content: AssistantMessage["content"] = [];
	if (reply.text?.trim()) content.push({ type: "text", text: reply.text });
	for (const call of reply.toolCalls ?? []) {
		const args = call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments) ? (call.arguments as JsonObject) : {};
		content.push({ type: "toolCall", id: `call_${nanoid(10)}`, name: call.name, arguments: args });
	}
	const usesTools = content.some((c) => c.type === "toolCall");
	return { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, usage: { ...ZERO_USAGE, cost: { ...ZERO_USAGE.cost } }, stopReason: usesTools ? "toolUse" : "stop", timestamp: Date.now() };
}

/** Replay a finished message as the normal event sequence, so every
 *  consumer that renders deltas sees the shape a real provider emits. */
function emit(output: AssistantMessageEventStream, message: AssistantMessage): void {
	const partial: AssistantMessage = { ...message, content: [] };
	output.push({ type: "start", partial: { ...partial } });
	message.content.forEach((block, contentIndex) => {
		if (block.type === "text") {
			partial.content.push({ type: "text", text: "" });
			output.push({ type: "text_start", contentIndex, partial: { ...partial, content: [...partial.content] } });
			partial.content[contentIndex] = block;
			output.push({ type: "text_delta", contentIndex, delta: block.text, partial: { ...partial, content: [...partial.content] } });
			output.push({ type: "text_end", contentIndex, content: block.text, partial: { ...partial, content: [...partial.content] } });
		} else if (block.type === "toolCall") {
			partial.content.push(block);
			output.push({ type: "toolcall_start", contentIndex, partial: { ...partial, content: [...partial.content] } });
			output.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: { ...partial, content: [...partial.content] } });
		}
	});
	output.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
}

function wake(): void {
	const s = state();
	for (const waiter of s.waiters) waiter();
	s.waiters.clear();
}

/** The stream function for one labelled engine. */
export function externalStream(label: ExternalLabel): StreamFunction {
	return (model, context, options) => {
		const output = new AssistantMessageEventStream();
		const s = state();
		const fail = (error: string, aborted = false) => {
			output.push({ type: "error", reason: aborted ? "aborted" : "error", error: { ...replyMessage(model, {} as DriverReply), stopReason: aborted ? "aborted" : "error", errorMessage: error } });
			output.end();
		};
		if (options?.signal?.aborted) { fail("Aborted", true); return output; }
		const messages = context.messages.filter((m, i) => !(i === 0 && m.role === "system"));
		const firstTurn = messages.find((m) => m.role !== "system");
		const id = `r_${nanoid(8)}`;
		let watchdog: ReturnType<typeof setInterval> | undefined;
		const parked: Parked = {
			id,
			label,
			thread: hash([label.role, label.chatId ?? "", firstTurn ? toDriverMessages([firstTurn]) : null]),
			systemPrompt: getCurrentSystemPrompt(context.messages),
			tools: getCurrentTools(context.messages).map((tool) => {
				const t = toToolDeclaration(tool);
				return { name: t.name, description: t.description, parameters: t.parameters };
			}),
			messages: toDriverMessages(messages),
			createdAt: Date.now(),
			settle: (outcome) => {
				if (!s.parked.delete(id)) return;
				clearInterval(watchdog);
				options?.signal?.removeEventListener("abort", onAbort);
				if ("reply" in outcome) { emit(output, replyMessage(model, outcome.reply)); output.end(); }
				else fail(outcome.error, outcome.aborted);
			},
		};
		const onAbort = () => parked.settle({ error: "Aborted", aborted: true });
		options?.signal?.addEventListener("abort", onAbort, { once: true });
		watchdog = setInterval(() => {
			if (!parked.claimedAt && !driverConnected() && Date.now() - parked.createdAt > UNCONNECTED_MS) parked.settle({ error: NOT_CONNECTED });
		}, 1000);
		watchdog.unref?.();
		s.parked.set(id, parked);
		wake();
		return output;
	};
}

function deliver(p: Parked, full: boolean): DriverRequest {
	const s = state();
	const promptHash = hash(p.systemPrompt);
	const toolsHash = hash(p.tools);
	const prev = full ? undefined : s.threads.get(p.thread);
	const role = full ? undefined : s.roles.get(p.label.role);
	// A thread only grows within a run; anything shorter is a rebuilt
	// (compacted) history and goes out whole.
	const prior = prev && prev.sent <= p.messages.length ? prev.sent : 0;
	// Both or neither: promptFrom must name one request that carried both.
	const same = role?.promptHash === promptHash && role.toolsHash === toolsHash;
	s.threads.set(p.thread, { lastId: p.id, sent: p.messages.length });
	s.roles.set(p.label.role, { lastId: same ? role!.lastId : p.id, promptHash, toolsHash });
	return {
		requestId: p.id,
		role: p.label.role,
		...(p.label.chatId ? { chatId: p.label.chatId } : {}),
		systemPrompt: same ? null : p.systemPrompt,
		tools: same ? null : p.tools,
		messages: p.messages.slice(prior),
		prior,
		...(prior ? { previousId: prev!.lastId } : {}),
		...(same ? { promptFrom: role!.lastId } : {}),
	};
}

/** Long-poll: the oldest unclaimed request (claiming it), or null on timeout. */
export async function driverNext(timeoutMs: number, signal?: AbortSignal): Promise<DriverRequest | null> {
	const s = state();
	// A silent spell means the agent restarted: what it held is gone, so the next requests go out whole.
	if (s.activePolls === 0 && Date.now() - s.lastSeen > ACTIVE_MS) { s.threads.clear(); s.roles.clear(); }
	s.lastSeen = Date.now();
	s.activePolls++;
	try {
		const deadline = Date.now() + Math.max(0, Math.min(timeoutMs, 60_000));
		for (;;) {
			const next = [...s.parked.values()].filter((p) => !p.claimedAt).sort((a, b) => a.createdAt - b.createdAt)[0];
			if (next) {
				next.claimedAt = Date.now();
				return deliver(next, false);
			}
			const left = deadline - Date.now();
			if (left <= 0 || signal?.aborted) return null;
			await new Promise<void>((resolve) => {
				const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); s.waiters.delete(done); resolve(); };
				const timer = setTimeout(done, left);
				signal?.addEventListener("abort", done, { once: true });
				s.waiters.add(done);
			});
		}
	} finally {
		s.activePolls--;
		s.lastSeen = Date.now();
	}
}

/** Re-fetch a request still waiting for its reply (lost context). */
export function driverRefetch(requestId: string, full: boolean): DriverRequest | null {
	const s = state();
	s.lastSeen = Date.now();
	const p = s.parked.get(requestId);
	if (!p) return null;
	p.claimedAt ??= Date.now();
	return deliver(p, full);
}

export function driverRespond(reply: DriverReply): { ok: true } | { ok: false; status: number; error: string } {
	const s = state();
	s.lastSeen = Date.now();
	const p = s.parked.get(reply.requestId);
	if (!p) return { ok: false, status: 409, error: `Request ${reply.requestId} is no longer waiting (answered, aborted, or unknown). Call lh_next.` };
	if (!reply.text?.trim() && !reply.toolCalls?.length) return { ok: false, status: 400, error: "A reply needs text, toolCalls, or both." };
	if (reply.toolCalls?.some((c) => typeof c?.name !== "string" || !c.arguments || typeof c.arguments !== "object" || Array.isArray(c.arguments))) {
		return { ok: false, status: 400, error: "Each tool call needs a name and an arguments object." };
	}
	p.settle({ reply });
	return { ok: true };
}

export function driverStatus(): { connected: boolean; pending: { requestId: string; role: string; chatId?: string; claimed: boolean; ageSeconds: number }[] } {
	const now = Date.now();
	return {
		connected: driverConnected(now),
		pending: [...state().parked.values()].map((p) => ({
			requestId: p.id,
			role: p.label.role,
			...(p.label.chatId ? { chatId: p.label.chatId } : {}),
			claimed: !!p.claimedAt,
			ageSeconds: Math.round((now - p.createdAt) / 1000),
		})),
	};
}
