import { ReviewError, getReview } from "@/src/server";

export const dynamic = "force-dynamic";

/** One review set: its status, questions and answers so far. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	try {
		return Response.json(getReview((await params).id));
	} catch (err) {
		if (err instanceof ReviewError) return Response.json({ error: err.message }, { status: err.status });
		throw err;
	}
}
