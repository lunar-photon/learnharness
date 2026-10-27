#!/usr/bin/env node
/**
 * lh-mcp.mjs — the MCP stdio server that lets ANY terminal agent (Claude
 * Code, Codex, Gemini CLI, opencode, Antigravity) be LearnHarness's model.
 *
 * The app parks every model request (teacher, prober, research, extraction,
 * …) in a queue when its provider is "external"; this server lets the agent
 * pull those requests and post replies (docs/agent-driver-plan.md). It is a
 * thin HTTP client of the running app plus a launcher — no state of its own.
 * Hand-rolled JSON-RPC (newline-delimited, MCP stdio transport): four
 * methods do not justify an SDK dependency.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.LH_PORT || 3517);
const BASE = `http://127.0.0.1:${PORT}`;
const POLL_MS = 45_000; // under every client's default tool timeout
const VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `LearnHarness is a learning app. You are its model: it sends you requests, you answer them.
Loop: lh_launch (once) → lh_next → answer the request in its role → lh_respond → lh_next again, until the user stops you.
- Each request carries a role (teacher, prober, practice, research, extractor, planner, learner_modeler, …), a system prompt, tool schemas and the conversation. Act exactly as that role's system prompt says; you are not yourself while answering it. Reply with learner-facing text and/or calls to the request's tools (never your own tools). Text and tool calls go to the learner's browser, not to the terminal.
- "No pending request" is normal (the learner is reading or answering): call lh_next again immediately. Never stop polling on your own.
- If you can run sub-agents, hand background roles (research, extractor, learner_modeler, planner) to a sub-agent with the request and lh_respond, and keep polling; answer teacher/prober/practice yourself.
- Before sending a multi-step explanation, run the explanation_reviewer role (lh_role) on your draft; when it contains non-trivial maths, run the verifier role. Use sub-agents for these when available.
- Unchanged system prompts and tool lists are not resent; if you lost them, call lh_next with requestId and full: true.`;

const TOOLS = [
	{
		name: "lh_launch",
		description: "Start the LearnHarness app (if not running) on 127.0.0.1, open it in the browser, and return its URL. Call once at the start.",
		inputSchema: { type: "object", properties: { open: { type: "boolean", description: "Open the browser (default true)." } } },
	},
	{
		name: "lh_next",
		description: "Wait (≤45 s) for the next model request from LearnHarness. Returns the request or 'No pending request' — then call again. With requestId (+ full: true) re-fetches one request in full.",
		inputSchema: { type: "object", properties: { requestId: { type: "string" }, full: { type: "boolean" } } },
	},
	{
		name: "lh_respond",
		description: "Answer a request. text = what the role says (learner-facing for teacher/prober/practice); toolCalls = calls to the REQUEST's tools, with arguments matching their schemas.",
		inputSchema: {
			type: "object",
			required: ["requestId"],
			properties: {
				requestId: { type: "string" },
				text: { type: "string" },
				toolCalls: {
					type: "array",
					items: { type: "object", required: ["name", "arguments"], properties: { name: { type: "string" }, arguments: { type: "object" } } },
				},
			},
		},
	},
	{
		name: "lh_role",
		description: "Instructions for an agent-side role you run yourself: explanation_reviewer or verifier.",
		inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string", enum: ["explanation_reviewer", "verifier"] } } },
	},
	{
		name: "lh_status",
		description: "App status: whether it is running, its URL, and pending/claimed requests.",
		inputSchema: { type: "object", properties: {} },
	},
];

async function api(path, init = {}) {
	const res = await fetch(BASE + path, { ...init, headers: { "content-type": "application/json", ...init.headers } });
	const body = res.status === 204 ? null : await res.text();
	return { status: res.status, body: body ? JSON.parse(body) : null };
}

async function running() {
	try { return (await api("/api/driver/status", { signal: AbortSignal.timeout(2000) })).status === 200; }
	catch { return false; }
}

function openBrowser(url) {
	const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

async function launch({ open = true } = {}) {
	const url = `${BASE}/`;
	if (!(await running())) {
		const log = join(tmpdir(), "learnharness-agent.log");
		const out = openSync(log, "a");
		const next = join(ROOT, "node_modules", "next", "dist", "bin", "next");
		// Loopback only: the driver routes let the caller act as the teacher.
		spawn(process.execPath, [next, "dev", "-H", "127.0.0.1", "-p", String(PORT)], { cwd: ROOT, env: { ...process.env, LH_AGENT_DRIVER: "1" }, detached: true, stdio: ["ignore", out, out] }).unref();
		const deadline = Date.now() + 120_000;
		while (!(await running())) {
			if (Date.now() > deadline) throw new Error(`LearnHarness did not start within 120 s — see ${log}`);
			await new Promise((r) => setTimeout(r, 1000));
		}
	}
	if (open) openBrowser(url);
	return `LearnHarness is running at ${url}. Ask the learner to start a session there with the "Agent" model, then call lh_next.`;
}

function formatRequest(req) {
	const head = [`Request ${req.requestId} · role: ${req.role}${req.chatId ? ` · chat: ${req.chatId}` : ""}`];
	head.push(req.systemPrompt == null ? `System prompt: unchanged since ${req.previousId}.` : `System prompt:\n${req.systemPrompt}`);
	head.push(req.tools == null ? `Tools: unchanged since ${req.previousId}.` : `Tools:\n${JSON.stringify(req.tools)}`);
	head.push(`Messages${req.prior ? ` (after the ${req.prior} already sent in ${req.previousId})` : ""}:\n${JSON.stringify(req.messages, null, 1)}`);
	head.push(`Answer with lh_respond { requestId: "${req.requestId}", text?, toolCalls? }.`);
	return head.join("\n\n");
}

async function call(name, args = {}) {
	switch (name) {
		case "lh_launch":
			return launch(args);
		case "lh_status": {
			if (!(await running())) return `LearnHarness is not running. Call lh_launch.`;
			return JSON.stringify({ url: `${BASE}/`, ...(await api("/api/driver/status")).body });
		}
		case "lh_next": {
			if (!(await running())) return `LearnHarness is not running. Call lh_launch.`;
			const q = args.requestId ? `requestId=${encodeURIComponent(args.requestId)}&full=${args.full ? 1 : 0}` : `timeoutMs=${POLL_MS}`;
			const { status, body } = await api(`/api/driver/next?${q}`, { signal: AbortSignal.timeout(POLL_MS + 10_000) });
			if (status === 204) return "No pending request (the learner is reading or answering). Call lh_next again now.";
			if (status !== 200) throw new Error(body?.error ?? `HTTP ${status}`);
			return formatRequest(body);
		}
		case "lh_respond": {
			const { status, body } = await api("/api/driver/respond", { method: "POST", body: JSON.stringify(args) });
			if (status !== 200) throw new Error(body?.error ?? `HTTP ${status}`);
			return "Delivered. Call lh_next.";
		}
		case "lh_role":
			return readFileSync(join(ROOT, "src", "agent", "prompts", "roles", `${String(args.name).replace(/[^a-z_]/g, "")}.md`), "utf8");
		default:
			throw new Error(`Unknown tool ${name}`);
	}
}

function send(message) {
	process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
}

async function handle(msg) {
	const { id, method, params } = msg;
	if (id === undefined) return; // notifications (initialized, cancelled) need no reply
	try {
		if (method === "initialize") {
			const requested = params?.protocolVersion;
			send({ id, result: {
				protocolVersion: PROTOCOLS.includes(requested) ? requested : PROTOCOLS[0],
				capabilities: { tools: {} },
				serverInfo: { name: "learnharness", version: VERSION },
				instructions: INSTRUCTIONS,
			} });
		} else if (method === "ping") send({ id, result: {} });
		else if (method === "tools/list") send({ id, result: { tools: TOOLS } });
		else if (method === "tools/call") {
			try { send({ id, result: { content: [{ type: "text", text: await call(params.name, params.arguments) }] } }); }
			catch (error) { send({ id, result: { content: [{ type: "text", text: String(error?.message ?? error) }], isError: true } }); }
		} else send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
	} catch (error) {
		send({ id, error: { code: -32603, message: String(error?.message ?? error) } });
	}
}

/** `npm run agent:setup`: Antigravity has no project-level MCP config, so
 *  register this server in its global one. The other agents read the
 *  repo's own config files (.mcp.json, .codex/, .gemini/, opencode.json). */
function setup() {
	const self = join(ROOT, "scripts", "lh-mcp.mjs");
	const agy = spawn("agy", ["mcp", "add", "learnharness", process.execPath, self], { stdio: "inherit" });
	agy.on("error", () => console.log(`agy not found — skipped. To add it later: agy mcp add learnharness ${process.execPath} ${self}`));
	agy.on("exit", (code) => {
		if (code !== 0) return;
		console.log("Registered learnharness with Antigravity (agy).");
		// lh_next fires every ~45 s: without an allow-rule agy prompts on every
		// call (and headless mode auto-denies). Only this server is allowed.
		const file = join(homedir(), ".gemini", "antigravity-cli", "settings.json");
		try {
			const settings = JSON.parse(readFileSync(file, "utf8"));
			const allow = (settings.permissions ??= {}).allow ??= [];
			if (!allow.includes("mcp(learnharness)")) {
				allow.push("mcp(learnharness)");
				writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
				console.log(`Allowed the learnharness tools in ${file}.`);
			}
		} catch (error) {
			console.log(`Could not update ${file} (${error.message}); agy will ask before each learnharness tool call.`);
		}
	});
}

if (process.argv[2] === "launch") {
	// `npm run agent`: the same launcher from the shell.
	launch().then((text) => console.log(text), (error) => { console.error(error.message); process.exit(1); });
} else if (process.argv[2] === "setup") {
	setup();
} else {
	createInterface({ input: process.stdin }).on("line", (line) => {
		if (!line.trim()) return;
		let msg;
		try { msg = JSON.parse(line); } catch { return send({ id: null, error: { code: -32700, message: "Parse error" } }); }
		void handle(msg);
	});
}
