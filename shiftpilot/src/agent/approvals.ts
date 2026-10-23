/**
 * Human-in-the-loop gates. Each approval stores the exact action it will run;
 * approving (on the dashboard or from WhatsApp) executes that action.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvals, type Approval } from "@/db/schema";
import { now } from "@/lib/clock";
import { emit } from "@/lib/events";
import { newId } from "@/lib/ids";
import { wa } from "@/whatsapp/types";
import { notifyManager } from "./ops";
import { audit, setRunStatus } from "./runs";

export type ApprovalAction = { type: string; [k: string]: unknown };
export type ApprovalOption = { id: string; label: string; detail: string; action: ApprovalAction };

export async function requestApproval(a: {
  orgId: string;
  runId?: string | null;
  kind: Approval["kind"];
  title: string;
  summary: string;
  action: ApprovalAction;
  options?: ApprovalOption[];
  risk: Approval["risk"];
  policyReason: string;
}) {
  const id = newId("apr");
  await db.insert(approvals).values({
    id,
    orgId: a.orgId,
    runId: a.runId ?? null,
    kind: a.kind,
    title: a.title,
    summary: a.summary,
    action: a.action,
    options: a.options ?? null,
    risk: a.risk,
    policyReason: a.policyReason,
    status: "pending",
    createdAt: await now(a.orgId),
  });
  await audit(a.orgId, { runId: a.runId, kind: "approval_requested", title: `Asked for approval: ${a.title}`, detail: { approvalId: id, policy: a.policyReason, risk: a.risk } });
  if (a.runId) await setRunStatus(a.runId, "waiting");
  await emit(a.orgId, "approval.created", { approvalId: id });

  // Ping the manager on WhatsApp so they can approve from their phone
  const short = a.summary.length > 700 ? a.summary.slice(0, 690) + "…" : a.summary;
  if (a.options?.length) {
    await notifyManager(
      a.orgId,
      wa.list(
        `*${a.title}*\n\n${short}\n\n_Policy: ${a.policyReason}_`,
        "Choose an option",
        [
          {
            title: "Options",
            rows: [
              ...a.options.slice(0, 9).map((o) => ({ id: `approval:choose:${id}:${o.id}`, title: o.label.slice(0, 24), description: o.detail.slice(0, 72) })),
              { id: `approval:reject:${id}`, title: "None of these", description: "I'll handle it myself" },
            ],
          },
        ],
        { header: "Approval needed" },
      ),
      { runId: a.runId, attention: true },
    );
  } else {
    await notifyManager(
      a.orgId,
      wa.buttons(
        `*${a.title}*\n\n${short}\n\n_Policy: ${a.policyReason}_`,
        [
          { id: `approval:approve:${id}`, title: "Approve" },
          { id: `approval:reject:${id}`, title: "Reject" },
          { id: `approval:details:${id}`, title: "Details" },
        ],
        { header: "Approval needed", footer: "ShiftPilot waits for you" },
      ),
      { runId: a.runId, attention: true },
    );
  }
  return id;
}

export async function decideApproval(id: string, decision: "approved" | "rejected", opts: { by: string; channel: "dashboard" | "whatsapp"; optionId?: string }) {
  const t = new Date();
  const updated = await db
    .update(approvals)
    .set({ status: decision, decidedBy: opts.by, decidedAt: t, channel: opts.channel, chosenOptionId: opts.optionId ?? null })
    .where(and(eq(approvals.id, id), eq(approvals.status, "pending")))
    .returning();
  const ap = updated[0];
  if (!ap) return { ok: false as const, error: "Already decided" };
  // Store decision time on the virtual clock
  await db.update(approvals).set({ decidedAt: await now(ap.orgId) }).where(eq(approvals.id, id));

  const option = opts.optionId ? ap.options?.find((o) => o.id === opts.optionId) : undefined;
  await audit(ap.orgId, {
    runId: ap.runId,
    kind: "approval_decided",
    actor: "manager",
    title: `${decision === "approved" ? "Approved" : "Rejected"}${option ? ` "${option.label}"` : ""}: ${ap.title} (via ${opts.channel})`,
    detail: { approvalId: id, optionId: opts.optionId },
  });
  await emit(ap.orgId, "approval.decided", { approvalId: id, decision });
  if (ap.runId) await setRunStatus(ap.runId, "running");

  const { executeApproval } = await import("./approval-actions");
  await executeApproval(ap, decision, option?.action);
  return { ok: true as const, approval: ap };
}
