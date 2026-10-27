import { driverStatus } from "@/src/server";

export const dynamic = "force-dynamic";

/** Liveness for the MCP launcher, and what the queue holds. */
export function GET() {
	return Response.json(driverStatus());
}
