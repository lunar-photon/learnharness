import { driverRespond, type DriverReply } from "@/src/server";

/** The external agent's answer to one parked request (docs/agent-driver-plan.md). */
export async function POST(req: Request) {
	const body = (await req.json().catch(() => null)) as DriverReply | null;
	if (!body || typeof body.requestId !== "string") return Response.json({ error: "Body must be { requestId, text?, toolCalls? }" }, { status: 400 });
	const result = driverRespond(body);
	return result.ok ? Response.json({ ok: true }) : Response.json({ error: result.error }, { status: result.status });
}
