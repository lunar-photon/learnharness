/**
 * The terminal-agent link for the desktop app (docs/agent-driver-plan.md):
 * the app's server listens on a random port behind a per-launch secret
 * (proxy.ts), so it publishes both in a file only this OS user can read,
 * where scripts/lh-mcp.mjs finds it. Also seeds the learner's PYQ folder
 * from the material bundled with the app, once.
 */
const fs = require("node:fs");
const path = require("node:path");

const FILE = "agent-connection.json";

function writeAgentConnection(dir, { url, secret }) {
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, FILE);
	fs.writeFileSync(file, JSON.stringify({ url, secret, pid: process.pid }), { mode: 0o600 });
	fs.chmodSync(file, 0o600); // mode only applies when the file is created
	return file;
}

/** Remove the file if this process wrote it (a second instance must not delete the first's). */
function removeAgentConnection(dir) {
	const file = path.join(dir, FILE);
	try {
		if (JSON.parse(fs.readFileSync(file, "utf8")).pid === process.pid) fs.unlinkSync(file);
	} catch {
		/* absent or unreadable: nothing to remove */
	}
}

/** Copy the bundled material into the learner's PYQ folder on first launch only, so their own edits are never overwritten. */
function seedPyq(bundled, target) {
	if (fs.existsSync(target) || !fs.existsSync(bundled)) return false;
	fs.cpSync(bundled, target, { recursive: true });
	return true;
}

module.exports = { FILE, writeAgentConnection, removeAgentConnection, seedPyq };
