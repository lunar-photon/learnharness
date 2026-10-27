import { ExamError, testResult, testView } from "@/src/server";

export const dynamic = "force-dynamic";

/** The test page's view: questions without answers until submitted, the
 *  time left; ?result=1 after submission returns the graded result. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; testId: string }> }) {
	const { id, testId } = await ctx.params;
	try {
		return Response.json(new URL(req.url).searchParams.get("result") === "1" ? testResult(id, testId) : testView(id, testId));
	} catch (err) {
		if (err instanceof ExamError) return Response.json({ error: err.message }, { status: err.status });
		throw err;
	}
}
