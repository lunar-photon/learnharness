import { openPyqFolder, pyqFolder } from "@/src/server";

export const dynamic = "force-dynamic";

/** The learner's exam-material folder (PYQ/README.md). */
export function GET() {
	return Response.json(pyqFolder());
}

/** Open it in the system file manager. */
export function POST() {
	return Response.json(openPyqFolder());
}
