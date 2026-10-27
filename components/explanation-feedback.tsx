"use client";

import { useContext, useState } from "react";
import { FEEDBACK_REASONS, FEEDBACK_REASON_LABELS, feedbackMessage, type FeedbackReason } from "@/src/core";
import { ChatActionsContext } from "@/components/chat";

const chip = "rounded-sm border px-2 py-0.5 font-ui text-xs transition-colors cursor-pointer";
const idle = `${chip} border-border bg-card text-muted-foreground hover:border-muted-foreground/50 hover:bg-accent hover:text-foreground`;
const on = `${chip} border-foreground/40 bg-accent text-foreground`;

/**
 * "Did this explanation land?" under a teacher explanation (docs/agent-
 * driver-plan.md §5). A verdict is stored for the learner modeler; a miss
 * also goes to the teacher — at once when the composer is free, otherwise
 * through the next turn's prompt. A miss followed by a later "landed" forms
 * the first-vs-liked pair the explanation reviewer learns the style from.
 */
export function ExplanationFeedback({ messageId }: { messageId: string }) {
	const actions = useContext(ChatActionsContext);
	// shortcut: the verdict lives in component state, so a reload shows the buttons again; read feedback back from the server if that confuses.
	const [stage, setStage] = useState<"ask" | "why" | "landed" | "sent" | "queued">("ask");
	const [reasons, setReasons] = useState<FeedbackReason[]>([]);
	const [note, setNote] = useState("");
	const [error, setError] = useState<string | null>(null);
	if (!actions) return null;

	const submit = async (landed: boolean) => {
		setError(null);
		const res = await fetch(`/api/chats/${actions.chatId}/feedback`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ messageId, landed, reasons: landed ? [] : reasons, note: landed ? undefined : note.trim() || undefined }),
		}).catch(() => null);
		if (!res?.ok) {
			setError("Couldn't save that. Try again.");
			return;
		}
		if (landed) return setStage("landed");
		if (actions.canSendText) {
			actions.sendText(feedbackMessage(reasons, note));
			return setStage("sent");
		}
		setStage("queued");
	};

	if (stage === "landed") return <p className="mt-1 font-ui text-xs text-muted-foreground" role="status">Noted: this one landed.</p>;
	if (stage === "sent") return <p className="mt-1 font-ui text-xs text-muted-foreground" role="status">Sent to your teacher.</p>;
	if (stage === "queued") return <p className="mt-1 font-ui text-xs text-muted-foreground" role="status">Noted. Your teacher will see it with your next answer.</p>;

	return (
		<div className="mt-1 flex flex-col gap-1.5" data-testid="explanation-feedback">
			<div className="flex items-center gap-1.5">
				<span className="font-ui text-xs text-muted-foreground">Did this land?</span>
				<button type="button" className={idle} onClick={() => void submit(true)}>Landed</button>
				<button type="button" className={stage === "why" ? on : idle} aria-expanded={stage === "why"} onClick={() => setStage(stage === "why" ? "ask" : "why")}>
					Didn't land
				</button>
			</div>
			{stage === "why" && (
				<div className="flex flex-col gap-1.5" role="group" aria-label="Why it didn't land">
					<div className="flex flex-wrap gap-1.5">
						{FEEDBACK_REASONS.map((r) => (
							<button
								key={r}
								type="button"
								aria-pressed={reasons.includes(r)}
								className={reasons.includes(r) ? on : idle}
								onClick={() => setReasons((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]))}
							>
								{FEEDBACK_REASON_LABELS[r]}
							</button>
						))}
					</div>
					<div className="flex gap-1.5">
						<input
							aria-label="What would help (optional)"
							placeholder="What would help? (optional)"
							value={note}
							onChange={(e) => setNote(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && void submit(false)}
							className="min-w-0 flex-1 rounded-sm border border-border bg-card px-2 py-0.5 font-ui text-xs text-foreground"
						/>
						<button type="button" className={idle} onClick={() => void submit(false)}>Send</button>
					</div>
				</div>
			)}
			{error && <p className="font-ui text-xs text-destructive" role="alert">{error}</p>}
		</div>
	);
}
