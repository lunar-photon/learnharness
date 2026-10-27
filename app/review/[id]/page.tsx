import { notFound } from "next/navigation";
import { ReviewRun } from "@/components/review/review-run";
import { stores } from "@/src/server";

export const dynamic = "force-dynamic";

/** A spaced-review set over the knowledge map; the client owns the flow. */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!stores.reviewStore.getSet(id)) notFound();
	return <ReviewRun id={id} />;
}
