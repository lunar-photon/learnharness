"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { subscriptionLabels, subscriptionLabel, type SessionPricing, type TurnUsage } from "@/src/core";
import { formatTokens, formatUsd, planCostLabel, prettyModel } from "@/components/usage-format";
import { ModelControl, catalogLimits, useModelCatalog } from "@/components/model-picker";

export function formatContextMeasurement(tokens: number | null, limit: number | null): string {
	const numerator = tokens === null ? "?" : formatTokens(tokens);
	return limit === null ? numerator : `${numerator} / ${formatTokens(limit)}`;
}

/**
 * The below-composer bar (wave 4 observability; owner, 2026-10-27: one ⋯
 * menu, less to read): the leading slot (the map's mode switch), the live
 * dictation meter while recording, and a ⋯ button whose menu holds the
 * session's context and cost, the per-turn detail, Dictate, and the model +
 * thinking controls. The menu stays mounted (hidden) so the model control
 * keeps feeding the context limit.
 *
 * Spending arrives already priced by the server through Pi's catalog and
 * calculator. Missing cost stays "—", never fake zero. Context is a separate
 * completed-conversation measurement, never a money-log/summarizer fold or
 * transcript estimate. Its catalog denominator follows the selected model;
 * model changes preserve the numerator. Successful compaction clears it to ?.
 * Pre-chat views (home, /chat/new) have no session data, so the menu shows
 * only Dictate and the model controls.
 */
export function StatsBar({
	turns,
	contextTokens = null,
	pricing,
	dictationSlot,
	dictating = false,
	chatId,
	leadingSlot,
}: {
	turns: TurnUsage[];
	contextTokens?: number | null;
	pricing?: SessionPricing;
	/** The bound session (per-session models, owner 2026-09-28): present
	 *  on the in-session bar — the model control binds THE SESSION'S own
	 *  record; absent on the draft surfaces, where it binds the strong
	 *  slot (the new-session default). */
	chatId?: string;
	/** The dictation control (STT wave): in the menu while idle; in the bar
	 *  itself while recording, so the live meter and Stop stay in view. */
	dictationSlot?: ReactNode;
	dictating?: boolean;
	/** The row's LEFT edge (practice sessions, 2026-10-04): the map
	 *  composer's teach | practice switch rides here. */
	leadingSlot?: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const [selectedModel, setSelectedModel] = useState<string | undefined>();
	// Close on any pointerdown outside the menu (its own pickers' popups
	// excepted) or on Escape.
	const barRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const t = e.target as Element | null;
			if (barRef.current?.contains(t) || t?.closest?.('[data-lh-menu], [data-radix-popper-content-wrapper], [role="menu"], [role="listbox"]')) return;
			setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				// Claimed at the document level: the one-Esc law (the menu is
				// the surfaced layer, so the abort chain must not also fire).
				e.preventDefault();
				e.stopPropagation();
				setOpen(false);
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	const { catalog } = useModelCatalog();
	const limits = useMemo(() => (catalog ? catalogLimits(catalog) : undefined), [catalog]);
	const limit = selectedModel ? limits?.get(selectedModel) ?? null : null;
	const contextLabel = formatContextMeasurement(contextTokens, limit);
	const { cost = 0, unpriced = turns.length, subscription = 0 } = pricing ?? {};
	const pricedCount = turns.length - unpriced - subscription;
	const providers = pricing?.subscriptionProviders ?? subscriptionLabels(turns.map((turn) => turn.model));
	const costLabel = planCostLabel(pricedCount > 0 ? cost : null, providers);
	const hasSession = !!chatId || turns.length > 0;

	return (
		<div data-testid="stats-bar" className="pointer-events-auto relative flex items-center gap-3 px-3 pt-2 text-xs text-muted-foreground">
			{leadingSlot}
			{dictating && dictationSlot && <div className="flex min-w-0 flex-1 items-center justify-center">{dictationSlot}</div>}
			<div ref={barRef} className="relative ml-auto">
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					aria-expanded={open}
					aria-label="Session menu: stats, dictation, model"
					data-testid="stats-menu"
					className="flex h-7 w-9 items-center justify-center rounded-full text-lg font-black leading-none transition-colors hover:bg-muted hover:text-foreground"
				>
					⋯
				</button>
				<div
					data-testid="stats-detail"
					hidden={!open}
					className="absolute bottom-full right-0 z-40 mb-1.5 w-80 rounded-2xl border-2 border-b-4 bg-card p-3 text-xs shadow-xl"
				>
					{hasSession && (
						<div className="mb-3 flex flex-col gap-1 text-muted-foreground">
							<div className="mb-1 text-sm font-black text-card-foreground">This session</div>
							<div className="flex justify-between gap-2">
								<span>Context (last call)</span>
								<span className="tabular-nums text-card-foreground" data-testid="stats-context">{contextLabel}</span>
							</div>
							<div className="flex justify-between gap-2">
								<span>{subscription ? "Usage" : "Total cost"}</span>
								<span className="tabular-nums text-card-foreground" data-testid="stats-cost">{costLabel}</span>
							</div>
							{providers.includes("ChatGPT") && <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer" className="underline underline-offset-2">Manage ChatGPT usage</a>}
							{unpriced > 0 && (
								<div className="flex justify-between gap-2">
									<span>Unpriced turns</span>
									<span className="tabular-nums text-card-foreground">{unpriced}</span>
								</div>
							)}
							{turns.length > 0 && (
								<ul className="mt-1 flex max-h-40 flex-col gap-1 overflow-y-auto border-t pt-1.5">
									{turns.map((turn, i) => {
										const c = pricing?.turnCosts[turn.id] ?? null;
										return (
											<li key={`${turn.messageId}-${i}`} className="flex items-center justify-between gap-2">
												<span className="truncate">#{i + 1} · {prettyModel(turn.model, true)}</span>
												<span className="flex shrink-0 items-center gap-2 tabular-nums text-card-foreground">
													<span className="text-muted-foreground">{turn.steps.length} steps</span>
													<span>{subscriptionLabel(turn.model) ?? (c === null ? "—" : formatUsd(c))}</span>
												</span>
											</li>
										);
									})}
								</ul>
							)}
						</div>
					)}
					{!dictating && dictationSlot && <div className="mb-3 flex">{dictationSlot}</div>}
					<div className="flex items-center justify-between gap-2">
						<span className="text-sm font-black text-card-foreground">Model</span>
						<ModelControl chatId={chatId} onModelChange={setSelectedModel} />
					</div>
				</div>
			</div>
		</div>
	);
}
