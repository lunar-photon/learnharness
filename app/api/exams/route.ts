import { examDashboard, readyExams, stores } from "@/src/server";

export const dynamic = "force-dynamic";

/** Every exam with its progress (the home's streak, XP and topic path), and the exams that ship ready. */
export function GET() {
	return Response.json({ exams: stores.examStore.listExams().map((e) => examDashboard(e.id)), ready: readyExams() });
}
