import { ExamDashboard } from "@/components/exam/exam-dashboard";

export const dynamic = "force-dynamic";

/** The exam dashboard (docs/agent-driver-plan.md §6b). */
export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	return <ExamDashboard examId={id} />;
}
