import { examPipeline, stores } from "@/src/server";

/** Start a new test from the dashboard: { kind: "quiz" | "mock" }. Writing
 *  it runs in the background; the returned test is "generating". */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
	const { id } = await ctx.params;
	if (!stores.examStore.getExam(id)) return Response.json({ error: "Unknown exam" }, { status: 404 });
	const body = (await req.json().catch(() => null)) as { kind?: unknown } | null;
	if (body?.kind !== "quiz" && body?.kind !== "mock") return Response.json({ error: "kind must be quiz or mock" }, { status: 400 });
	if (stores.examStore.readPyqs(id).length < 5) return Response.json({ error: "The past-paper bank is still empty. Ask your exam session to read the papers first." }, { status: 409 });
	const test = examPipeline.startTest(id, body.kind, {}, (err) => console.error(`[exam ${id}] test generation failed:`, err));
	return Response.json({ id: test.id, status: test.status });
}
