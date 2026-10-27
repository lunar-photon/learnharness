import { ExamError, startTest } from "@/src/server";

/** Starts the clock (idempotent). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; testId: string }> }) {
	const { id, testId } = await ctx.params;
	try { return Response.json(startTest(id, testId)); } catch (err) {
		if (err instanceof ExamError) return Response.json({ error: err.message }, { status: err.status });
		throw err;
	}
}
