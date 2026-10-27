import { notFound } from "next/navigation";
import { ExamTest } from "@/components/exam/exam-test";
import { stores } from "@/src/server";

export const dynamic = "force-dynamic";

/** A timed test (docs/agent-driver-plan.md §6b); the client owns the flow. */
export default async function ExamTestPage({ params }: { params: Promise<{ id: string; testId: string }> }) {
	const { id, testId } = await params;
	if (!stores.examStore.getTest(id, testId)) notFound();
	return <ExamTest examId={id} testId={testId} />;
}
