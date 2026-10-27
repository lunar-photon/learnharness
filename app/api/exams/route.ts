import { ensureDefaultExams, examDashboard, stores } from "@/src/server";

export const dynamic = "force-dynamic";

/** Every exam with its progress (the home panel's streak, XP and topic path). */
export function GET() {
	ensureDefaultExams();
	return Response.json({ exams: stores.examStore.listExams().map((e) => examDashboard(e.id)) });
}
