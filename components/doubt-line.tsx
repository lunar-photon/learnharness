"use client";

import { useState } from "react";

/**
 * "Stuck? Ask a doubt" under an open question: sending pauses the question
 * (never graded), the teacher answers, then poses the check again
 * (core/input-events.ts, the text-while-pending rule).
 */
export function DoubtLine({ onAsk, disabled }: { onAsk: (text: string) => void; disabled?: boolean }) {
	const [text, setText] = useState("");
	const send = () => {
		const t = text.trim();
		if (!t || disabled) return;
		setText("");
		onAsk(t);
	};
	return (
		<form
			className="flex items-center gap-2 border-t px-3 py-2"
			onSubmit={(e) => {
				e.preventDefault();
				send();
			}}
		>
			<label className="sr-only" htmlFor="doubt-input">Ask a doubt about this question</label>
			<input
				id="doubt-input"
				value={text}
				onChange={(e) => setText(e.target.value)}
				placeholder="Stuck? Ask a doubt; the question waits for you."
				className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1.5 font-ui text-xs text-foreground outline-none placeholder:text-muted-foreground"
			/>
			<button
				type="submit"
				disabled={!text.trim() || disabled}
				className="lh-btn lh-btn-primary"
			>
				Ask
			</button>
		</form>
	);
}
