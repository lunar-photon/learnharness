/**
 * THE COMPOSITION ROOT for storage — the single place concrete store
 * adapters are wired. Everything else (core, services, agents) codes against
 * the port types in core/ports.ts and receives instances through this
 * module. Swapping the fs adapter for SQLite later changes exactly this
 * file (and the adapter implementations in src/store/).
 */

import { chatStore } from "../store/chats.ts";
import { graphStore } from "../store/graph.ts";
import { jobStore } from "../store/jobs.ts";
import { settingsStore } from "../store/settings.ts";
import { resolveSettings, type EffectiveSettings } from "../core/settings-resolution.ts";
import { CURRENT_SETTINGS_VERSION, type ModelSlot, type UserSettings } from "../core/settings.ts";
import { EXTERNAL_MODEL_ID, EXTERNAL_PROVIDER } from "../agent/external-engine.ts";
/** The wired adapters. Satisfies core/graph.ts's GraphDeps structurally. */
export const stores = {
	chatStore,
	graphStore,
	jobStore,
	settingsStore,
};

export type Stores = typeof stores;

/**
 * The resolved view of the settings record (core/settings-resolution.ts):
 * every knob concrete over its factory default — EXCEPT MODELS (BYOK all
 * the way down, owner 2026-09-22): no factory pins exist, so unset model
 * slots resolve to null and per-need refusal gates fire downstream. Read
 * fresh on every call — the record is a small file and turns are rare, so
 * no caching layer (stale toggles after a settings PUT would be worse).
 */
export function effectiveSettings(): EffectiveSettings {
	return resolveSettings(settingsRecord());
}

/** The settings record as the turn pipeline sees it. Launched by a terminal
 *  agent (scripts/lh-mcp.mjs sets LH_AGENT_DRIVER=1), every model slot the
 *  learner left unset runs on that agent; slots they set stay theirs. */
export function settingsRecord(): UserSettings | null {
	const record = settingsStore.readSettings();
	if (process.env.LH_AGENT_DRIVER !== "1") return record;
	const models = record?.models ?? {};
	const slot = (s: ModelSlot | undefined): ModelSlot => (s?.model ? s : { ...s, model: { provider: EXTERNAL_PROVIDER, id: EXTERNAL_MODEL_ID } });
	return { version: CURRENT_SETTINGS_VERSION, ...record, models: { ...models, strong: slot(models.strong), cheap: slot(models.cheap), vision: slot(models.vision) } };
}
