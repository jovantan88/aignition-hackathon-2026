import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { orgs, outlets, shiftTemplates, type OrgSettings } from "@/db/schema";
import { audit } from "@/agent/runs";
import { emit } from "@/lib/events";
import { activeOrgId } from "@/lib/org";

export async function GET(req: Request) {
  const orgId = await activeOrgId(req);
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, orgId) });
  const os = await db.select().from(outlets).where(eq(outlets.orgId, orgId)).orderBy(asc(outlets.code));
  const tpls = os.length ? await db.select().from(shiftTemplates).where(inArray(shiftTemplates.outletId, os.map((o) => o.id))).orderBy(asc(shiftTemplates.dow)) : [];
  return Response.json({ org, outlets: os, templates: tpls });
}

export async function PATCH(req: Request) {
  const orgId = await activeOrgId(req);
  const patch = (await req.json()) as Partial<OrgSettings>;
  const org = (await db.query.orgs.findFirst({ where: eq(orgs.id, orgId) }))!;
  const settings = { ...org.settings, ...patch };
  await db.update(orgs).set({ settings }).where(eq(orgs.id, orgId));
  await audit(orgId, { kind: "decision", actor: "manager", title: `Manager changed policy: ${Object.keys(patch).join(", ")}`, detail: patch as Record<string, unknown> });
  await emit(orgId, "conversation.updated", {});
  return Response.json({ ok: true, settings });
}
