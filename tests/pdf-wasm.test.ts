/**
 * Scanned PDFs (JBIG2 / JPEG 2000 page images) decode in pdfjs v6's
 * WebAssembly modules; a wrong wasmUrl makes every such page render blank,
 * silently, because pdf-ops/headless run pdfjs at verbosity 0 (the
 * 2026-10-27 MPSC scans incident). Pin the path to real decoder files.
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { pdfjsWasmDir } from "../src/agent/subagents/pdf-ops.ts";

describe("pdfjs wasm decoders", () => {
	it("resolve to the shipped JBIG2 and OpenJPEG modules", () => {
		for (const file of ["jbig2.wasm", "openjpeg.wasm"]) {
			assert.ok(fs.existsSync(path.join(pdfjsWasmDir(), file)), `${file} under ${pdfjsWasmDir()}`);
		}
	});
});
