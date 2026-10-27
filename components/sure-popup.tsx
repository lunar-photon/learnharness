"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** The four "How sure?" levels, shared by lesson checks and exam tests (50%, 70%, 90%, certain). */
export const SURE_LABELS = ["50%", "70%", "90%", "Certain"] as const;

/**
 * The "How sure?" popup that opens under a chosen answer. It rests on
 * Certain (a chosen answer is a committed one; the learner steps down from
 * it): ←/→ or ↑/↓ move, Enter or a click picks, 1–4 pick directly, Esc
 * closes without answering. Enter inside a child textarea picks the
 * highlighted level; Shift+Enter makes a newline there.
 */
export function SurePopup({ onPick, onClose, children }: { onPick: (level: number) => void; onClose: () => void; children?: ReactNode }) {
	const [level, setLevel] = useState(SURE_LABELS.length - 1);
	const buttons = useRef<(HTMLButtonElement | null)[]>([]);
	useEffect(() => {
		buttons.current[level]?.focus();
	}, [level]);
	const claim = (e: React.KeyboardEvent) => {
		e.preventDefault();
		e.stopPropagation();
	};
	return (
		<div
			role="dialog"
			aria-label="How sure are you?"
			data-testid="sure-popup"
			className="mt-2 flex flex-col gap-2 rounded-2xl border-2 border-b-4 border-[var(--lh-gold)] bg-[var(--lh-gold-tint)] p-3"
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					claim(e);
					onClose();
				} else if ((e.target as HTMLElement).tagName === "TEXTAREA") {
					if (e.key === "Enter" && !e.shiftKey) {
						claim(e);
						onPick(level);
					}
				} else if (/^[1-4]$/.test(e.key)) {
					claim(e);
					onPick(Number(e.key) - 1);
				} else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
					claim(e);
					setLevel((l) => Math.max(0, l - 1));
				} else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
					claim(e);
					setLevel((l) => Math.min(SURE_LABELS.length - 1, l + 1));
				}
			}}
		>
			<span className="text-sm font-black text-[var(--lh-gold-text)]">How sure?</span>
			<div className="grid grid-cols-4 gap-2">
				{SURE_LABELS.map((label, l) => (
					<button
						key={label}
						ref={(el) => {
							buttons.current[l] = el;
						}}
						type="button"
						data-testid={`sure-${l + 1}`}
						aria-pressed={l === level}
						onFocus={() => setLevel(l)}
						onClick={() => onPick(l)}
						className="lh-btn"
					>
						{label}
						<span className="sr-only"> (key {l + 1})</span>
					</button>
				))}
			</div>
			{children}
		</div>
	);
}
