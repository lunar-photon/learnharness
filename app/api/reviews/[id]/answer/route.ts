import { ReviewError, answerReview } from "@/src/server";

export const dynamic = "force-dynamic";

/** Answer one question: the server grades it and moves the node's review card. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
	try {
		return Response.json(answerReview((await params).id, body));
	} catch (err) {
		if (err instanceof ReviewError) return Response.json({ error: err.message }, { status: err.status });
		throw err;
	}
}
