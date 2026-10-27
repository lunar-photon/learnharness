import { ExamError, examDashboard, setDailyGoal } from "@/src/server";

export const dynamic = "force-dynamic";

function fail(err: unknown): Response {
	if (err instanceof ExamError) return Response.json({ error: err.message }, { status: err.status });
	throw err;
}

/** The exam dashboard: pattern, progress summary, PYQ bank size, tests. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
	const { id } = await ctx.params;
	try { return Response.json(examDashboard(id)); } catch (err) { return fail(err); }
}

/** The learner's settings for this exam (v1: the daily goal). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
	const { id } = await ctx.params;
	const body = (await req.json().catch(() => null)) as { dailyGoal?: unknown } | null;
	try { return Response.json({ exam: setDailyGoal(id, body?.dailyGoal) }); } catch (err) { return fail(err); }
}
