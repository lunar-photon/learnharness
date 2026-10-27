import { FEEDBACK_REASONS, type ExplanationFeedback, type FeedbackReason } from "@/src/core";
import { getChat, stores, triggerLearnerUpdate } from "@/src/server";

/**
 * The learner's verdict on one teacher explanation (docs/agent-driver-plan.md
 * §5): stored for the learner pipeline, which reviews first-vs-liked pairs.
 * A miss reaches the teacher through the next turn's prompt; the client also
 * sends it as a message when the composer is free.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	const chat = getChat(id);
	if (!chat) return Response.json({ error: "Unknown chat" }, { status: 404 });
	const body = (await req.json().catch(() => null)) as { messageId?: unknown; landed?: unknown; reasons?: unknown; note?: unknown } | null;
	const messageId = typeof body?.messageId === "string" ? body.messageId : "";
	const target = chat.messages.find((m) => (m as { id?: string }).id === messageId);
	if (!target || (target as { role?: string }).role !== "assistant") return Response.json({ error: "messageId must name a teacher message in this chat" }, { status: 400 });
	if (typeof body?.landed !== "boolean") return Response.json({ error: "landed must be true or false" }, { status: 400 });
	const reasons = Array.isArray(body.reasons) ? body.reasons : [];
	if (!reasons.every((r) => (FEEDBACK_REASONS as readonly unknown[]).includes(r))) return Response.json({ error: `reasons must be among: ${FEEDBACK_REASONS.join(", ")}` }, { status: 400 });
	const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
	const feedback: ExplanationFeedback = {
		id: `fb_${crypto.randomUUID()}`,
		at: new Date().toISOString(),
		chatId: id,
		messageId,
		landed: body.landed,
		reasons: [...new Set(reasons as FeedbackReason[])],
		...(note ? { note } : {}),
	};
	stores.learnerStore.appendFeedback(feedback);
	// A "landed" can close a first-vs-liked pair: review it now rather than after the next turn.
	if (feedback.landed) triggerLearnerUpdate(id);
	return Response.json({ ok: true });
}
