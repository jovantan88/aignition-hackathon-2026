import { tick } from "@/agent/jobs";

/** Heartbeat from open dashboards: runs anything that is due on the virtual clock */
export async function POST() {
  return Response.json({ ran: await tick() });
}
