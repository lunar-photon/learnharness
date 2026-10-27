/**
 * The desktop app's terminal-agent link (electron/agent-connection.cjs +
 * scripts/lh-mcp.mjs): the app publishes its random port and per-launch
 * secret in a user-only file; the MCP server finds it, sends the secret,
 * and falls back to the web server when the app is gone. The PYQ folder
 * is seeded from the bundle once and never overwritten.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { createInterface } from "node:readline";
import { after, describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { FILE, writeAgentConnection, removeAgentConnection, seedPyq } = require("../electron/agent-connection.cjs");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lh-desktop-link-"));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe("agent connection file", () => {
	it("is private to the user and removed only by the process that wrote it", () => {
		const dir = path.join(TMP, "userData");
		const file = writeAgentConnection(dir, { url: "http://127.0.0.1:1234", secret: "s3cret" });
		assert.equal(fs.statSync(file).mode & 0o777, 0o600);
		assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { url: "http://127.0.0.1:1234", secret: "s3cret", pid: process.pid });
		fs.writeFileSync(file, JSON.stringify({ url: "x", secret: "y", pid: 1 }));
		removeAgentConnection(dir);
		assert.ok(fs.existsSync(file), "another instance's link is left alone");
		writeAgentConnection(dir, { url: "x", secret: "y" });
		removeAgentConnection(dir);
		assert.ok(!fs.existsSync(path.join(dir, FILE)));
	});
});

describe("PYQ seeding", () => {
	it("copies the bundled material once and never over the learner's folder", () => {
		const bundled = path.join(TMP, "bundle", "PYQ");
		fs.mkdirSync(path.join(bundled, "CGL"), { recursive: true });
		fs.writeFileSync(path.join(bundled, "CGL", "paper.pdf"), "v1");
		const target = path.join(TMP, "user", "PYQ");
		assert.equal(seedPyq(bundled, target), true);
		assert.equal(fs.readFileSync(path.join(target, "CGL", "paper.pdf"), "utf8"), "v1");
		fs.writeFileSync(path.join(target, "CGL", "paper.pdf"), "learner's edit");
		assert.equal(seedPyq(bundled, target), false);
		assert.equal(fs.readFileSync(path.join(target, "CGL", "paper.pdf"), "utf8"), "learner's edit");
		assert.equal(seedPyq(path.join(TMP, "missing"), path.join(TMP, "other")), false);
	});
});

function mcp(env: Record<string, string>) {
	const child = spawn(process.execPath, ["scripts/lh-mcp.mjs"], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "inherit"] });
	const replies = new Map<number, (msg: any) => void>();
	createInterface({ input: child.stdout! }).on("line", (line) => { const m = JSON.parse(line); replies.get(m.id)?.(m); });
	let id = 0;
	const request = (method: string, params?: unknown) => new Promise<any>((resolve) => {
		replies.set(++id, resolve);
		child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
	});
	return { child, request };
}

describe("lh-mcp desktop discovery", () => {
	it("connects to the open desktop app with its secret, and falls back when it is gone", { timeout: 15000 }, async () => {
		const seen: (string | undefined)[] = [];
		const server = http.createServer((req, res) => {
			seen.push(req.headers["x-learnharness-desktop"] as string | undefined);
			if (req.headers["x-learnharness-desktop"] !== "s3cret") { res.writeHead(403).end(); return; }
			res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ connected: false, pending: [] }));
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		const port = (server.address() as { port: number }).port;
		const dir = path.join(TMP, "desktopDir");
		fs.mkdirSync(dir, { recursive: true });
		const link = path.join(dir, "agent-connection.json");
		fs.writeFileSync(link, JSON.stringify({ url: `http://127.0.0.1:${port}`, secret: "s3cret", pid: process.pid }));
		const { child, request } = mcp({ LH_DESKTOP_DIR: dir, LH_PORT: "1" });
		try {
			const status = JSON.parse((await request("tools/call", { name: "lh_status", arguments: {} })).result.content[0].text);
			assert.equal(status.app, "desktop");
			assert.equal(status.url, `http://127.0.0.1:${port}/`);
			assert.ok(seen.every((h) => h === "s3cret"), "every desktop call carries the secret");
			const launch = (await request("tools/call", { name: "lh_launch", arguments: { open: false } })).result.content[0].text;
			assert.match(launch, /Connected to the LearnHarness desktop app/);

			// The app quit but left its file behind (crash): a dead pid means no desktop app.
			fs.writeFileSync(link, JSON.stringify({ url: `http://127.0.0.1:${port}`, secret: "s3cret", pid: 2 ** 22 + 12345 }));
			const fallback = (await request("tools/call", { name: "lh_status", arguments: {} })).result.content[0].text;
			assert.match(fallback, /not running/, "falls back to the web server, which is not running here");
		} finally {
			child.kill();
			server.close();
		}
	});
});
