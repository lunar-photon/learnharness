import { ReviewError, reviewState, startReview } from "@/src/server";

export const dynamic = "force-dynamic";

/** The home card: how many map nodes are due, the next review, an open set. */
export function GET() {
	return Response.json(reviewState());
}

/** Start a review set over the due nodes (or return the one already open). */
export function POST() {
	try {
		const set = startReview();
		return Response.json({ id: set.id, status: set.status });
	} catch (err) {
		if (err instanceof ReviewError) return Response.json({ error: err.message }, { status: err.status });
		throw err;
	}
}
