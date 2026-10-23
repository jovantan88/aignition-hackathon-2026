import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, orgs, outlets, shifts, workers } from "@/db/schema";

/** Phone home screen: identity + chat list. id = worker id or "mgr_<org slug>" */
export async function GET(_req: Request, ctx: RouteContext<"/api/phone/[id]">) {
  const { id } = await ctx.params;

  if (id.startsWith("mgr_")) {
    const org = await db.query.orgs.findFirst({ where: eq(orgs.slug, id.slice(4)) });
    if (!org) return Response.json({ error: "not found" }, { status: 404 });
    const convs = await db.select().from(conversations).where(and(eq(conversations.orgId, org.id), eq(conversations.kind, "manager_dm")));
    return Response.json({
      identity: { kind: "manager", id, name: org.managerName, orgId: org.id, orgName: org.name, avatarHue: 200, subtitle: `Manager · ${org.name}`, phone: org.managerPhone },
      chats: await withUnread(convs.map((c) => ({ ...c, title: "ShiftPilot" }))),
    });
  }

  const worker = await db.query.workers.findFirst({ where: eq(workers.id, id) });
  if (!worker) return Response.json({ error: "not found" }, { status: 404 });
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, worker.orgId) });
  const home = worker.homeOutletId ? await db.query.outlets.findFirst({ where: eq(outlets.id, worker.homeOutletId) }) : null;

  // Groups for outlets they're rostered at this week + home outlet
  const rostered = await db
    .selectDistinct({ outletId: shifts.outletId })
    .from(shifts)
    .where(and(eq(shifts.workerId, worker.id), ne(shifts.status, "cancelled")));
  const outletIds = [...new Set([worker.homeOutletId, ...rostered.map((r) => r.outletId)].filter(Boolean) as string[])];
  const convs = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.orgId, worker.orgId),
        sql`(${conversations.workerId} = ${worker.id} or ${outletIds.length ? inArray(conversations.outletId, outletIds) : sql`false`})`,
      ),
    );
  const dm = convs.filter((c) => c.kind === "worker_dm").map((c) => ({ ...c, title: "ShiftPilot" }));
  const groups = convs.filter((c) => c.kind === "outlet_group");

  return Response.json({
    identity: {
      kind: "worker",
      id: worker.id,
      name: worker.name,
      orgId: worker.orgId,
      orgName: org?.name,
      avatarHue: worker.avatarHue,
      subtitle: `${worker.occupation} · ${home?.name ?? worker.homeArea}`,
      phone: worker.phone,
      language: worker.language,
      autopilot: worker.autopilot,
    },
    places: await placesFor(worker, org?.name ?? ""),
    chats: await withUnread([...dm, ...groups]),
  });
}

async function withUnread<T extends { id: string; lastMessageAt: Date | null }>(convs: T[]) {
  if (!convs.length) return [];
  const counts = await db
    .select({ conversationId: messages.conversationId, n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(inArray(messages.conversationId, convs.map((c) => c.id)), eq(messages.direction, "out"), ne(messages.status, "read"), ne(messages.status, "queued"), ne(messages.type, "reaction")))
    .groupBy(messages.conversationId);
  const map = new Map(counts.map((c) => [c.conversationId, c.n]));
  return convs
    .map((c) => ({ ...c, unread: map.get(c.id) ?? 0 }))
    .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0));
}


async function placesFor(worker: typeof workers.$inferSelect, orgName: string) {
  const upcoming = await db
    .selectDistinct({ outletId: shifts.outletId })
    .from(shifts)
    .where(and(eq(shifts.workerId, worker.id), inArray(shifts.status, ["confirmed", "assigned", "covered"])));
  const ids = [...new Set([worker.homeOutletId, ...upcoming.map((u) => u.outletId)].filter(Boolean) as string[])];
  const os = ids.length ? await db.select().from(outlets).where(inArray(outlets.id, ids)) : [];
  return [
    ...os.map((o) => ({ label: `${orgName} ${o.name}`, name: o.name, address: o.address, lat: o.lat + 0.0002, lng: o.lng - 0.0001, kind: "outlet" as const })),
    { label: `Home (${worker.homeArea})`, name: worker.homeArea, address: `${worker.homeArea}, Singapore`, lat: worker.homeLat, lng: worker.homeLng, kind: "home" as const },
  ];
}
