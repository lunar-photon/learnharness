import { driverNext, driverRefetch } from "@/src/server";

export const dynamic = "force-dynamic";

/**
 * The external agent's long-poll (docs/agent-driver-plan.md): the oldest
 * parked model request, claimed for this caller, or 204 after timeoutMs.
 * With requestId it re-fetches one still-waiting request (full=1 → whole
 * context, for an agent that lost its own).
 */
export async function GET(req: Request) {
	const params = new URL(req.url).searchParams;
	const requestId = params.get("requestId");
	if (requestId) {
		const request = driverRefetch(requestId, params.get("full") === "1");
		return request ? Response.json(request) : Response.json({ error: `Request ${requestId} is no longer waiting` }, { status: 404 });
	}
	const timeoutMs = Number(params.get("timeoutMs") ?? 30_000);
	const request = await driverNext(Number.isFinite(timeoutMs) ? timeoutMs : 30_000, req.signal);
	return request ? Response.json(request) : new Response(null, { status: 204 });
}
