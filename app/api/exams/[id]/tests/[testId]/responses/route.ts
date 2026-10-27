import { ExamError, saveResponse } from "@/src/server";

/** Autosave of one answer: { questionId, response }. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string; testId: string }> }) {
	const { id, testId } = await ctx.params;
	const body = (await req.json().catch(() => null)) as { questionId?: unknown; response?: unknown } | null;
	try { return Response.json(saveResponse(id, testId, body?.questionId, body?.response)); } catch (err) {
		if (err instanceof ExamError) return Response.json({ error: err.message }, { status: err.status });
		throw err;
	}
}
