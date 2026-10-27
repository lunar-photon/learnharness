/**
 * scripts/lh-mcp.mjs speaks MCP stdio (newline-delimited JSON-RPC) well
 * enough for every client: handshake with version negotiation, tool
 * listing, a tool call, and errors as JSON-RPC errors. The app is not
 * running here (an unused port), so lh_status must say so, not crash.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { describe, it } from "node:test";

function startServer() {
	const child = spawn(process.execPath, ["scripts/lh-mcp.mjs"], { env: { ...process.env, LH_PORT: "1" }, stdio: ["pipe", "pipe", "inherit"] });
	const replies = new Map<number, (msg: any) => void>();
	createInterface({ input: child.stdout! }).on("line", (line) => {
		const msg = JSON.parse(line);
		replies.get(msg.id)?.(msg);
	});
	let id = 0;
	const request = (method: string, params?: unknown) =>
		new Promise<any>((resolve) => {
			replies.set(++id, resolve);
			child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
		});
	return { child, request };
}

describe("lh-mcp stdio server", () => {
	it("handshakes, lists the driver tools, and answers a call while the app is down", { timeout: 10000 }, async () => {
		const { child, request } = startServer();
		try {
			const init = await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } });
			assert.equal(init.result.protocolVersion, "2025-03-26", "a supported requested version is echoed");
			assert.equal(init.result.serverInfo.name, "learnharness");
			assert.match(init.result.instructions, /lh_next/);
			child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

			const unknown = await request("initialize", { protocolVersion: "1999-01-01" });
			assert.equal(unknown.result.protocolVersion, "2025-06-18", "an unknown version gets the latest supported");

			const list = await request("tools/list");
			assert.deepEqual(list.result.tools.map((t: { name: string }) => t.name), ["lh_launch", "lh_next", "lh_respond", "lh_role", "lh_status"]);

			const status = await request("tools/call", { name: "lh_status", arguments: {} });
			assert.match(status.result.content[0].text, /not running/);

			for (const [name, heading] of [["explanation_reviewer", "# The explanation reviewer"], ["verifier", "# The verifier"]]) {
				const role = await request("tools/call", { name: "lh_role", arguments: { name } });
				assert.ok(role.result.content[0].text.startsWith(heading), `lh_role serves ${name}`);
			}

			const missing = await request("nope");
			assert.equal(missing.error.code, -32601);
		} finally {
			child.kill();
		}
	});
});
