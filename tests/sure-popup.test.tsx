import React, { act } from "react";
(globalThis as { React?: typeof React }).React = React;
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { SurePopup } from "../components/sure-popup.tsx";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });

test("How sure? rests on Certain; arrows move, 1–4 and clicks pick, Esc closes", async () => {
	const picks: number[] = [];
	let closed = 0;
	const host = document.createElement("div"); document.body.append(host);
	const root = createRoot(host);
	const key = (k: string) => act(async () => {
		// linkedom has no KeyboardEvent: a plain Event carrying `key`.
		const e = new window.Event("keydown", { bubbles: true, cancelable: true });
		Object.defineProperty(e, "key", { value: k });
		host.querySelector('[data-testid="sure-popup"]')!.dispatchEvent(e);
	});
	const pressed = () => host.querySelector('[aria-pressed="true"]')?.getAttribute("data-testid");
	try {
		await act(async () => root.render(<SurePopup onPick={(l) => picks.push(l)} onClose={() => closed++} />));
		assert.equal(pressed(), "sure-4", "rests on Certain");
		await key("ArrowLeft");
		await key("ArrowUp");
		assert.equal(pressed(), "sure-2", "← and ↑ step down");
		await key("ArrowRight");
		assert.equal(pressed(), "sure-3", "→ steps up");
		await key("ArrowRight"); await key("ArrowRight");
		assert.equal(pressed(), "sure-4", "clamped at Certain");
		await key("1");
		await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="sure-3"]')!.click());
		assert.deepEqual(picks, [0, 2], "a digit and a click pick their levels");
		await key("Escape");
		assert.equal(closed, 1);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});
