/** What happens after the manager decides on an approval */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { coverRequests, planningCycles, type Approval } from "@/db/schema";
import { emit } from "@/lib/events";
import { sendMessage } from "@/whatsapp/send";
import { wa } from "@/whatsapp/types";
import { groupConv } from "./ops";
import { audit, finishRun, setStep } from "./runs";
import type { ApprovalAction } from "./approvals";

export async function executeApproval(ap: Approval, decision: "approved" | "rejected", optionAction?: ApprovalAction) {
  if (decision === "rejected") {
    if (ap.kind === "broadcast" && ap.runId) {
      await setStep(ap.runId, 4, "blocked", "Manager said no. Nothing was sent.");
      await finishRun(ap.runId, "Stopped: the manager rejected messaging the team.", "failed");
    }
    if (ap.kind === "publish_roster" && ap.action.cycleId) {
      await db.update(planningCycles).set({ status: "negotiating" }).where(eq(planningCycles.id, String(ap.action.cycleId)));
      if (ap.runId) await setStep(ap.runId, 10, "blocked", "Manager wants changes before publishing. Edit on the roster page, then publish again.");
    }
    if (ap.kind === "escalation" && ap.runId) {
      await setStep(ap.runId, 4, "blocked", "Manager is handling this one personally");
    }
    return;
  }

  const action = optionAction ?? ap.action;
  switch (action.type) {
    case "weekly.broadcast": {
      const { broadcastAvailability } = await import("./workflows/weekly");
      await broadcastAvailability(String(action.cycleId));
      break;
    }
    case "weekly.publish": {
      const { publishCycle } = await import("./workflows/weekly");
      await publishCycle(String(action.cycleId));
      break;
    }
    case "cover.offer_direct": {
      const { coverSearch } = await import("./workflows/cover");
      await db.update(coverRequests).set({ status: "searching" }).where(eq(coverRequests.id, String(action.coverRequestId)));
      await coverSearch(String(action.coverRequestId), { forceWorkerIds: action.workerIds as string[], note: String(action.note ?? "") });
      break;
    }
    case "cover.incentive": {
      const { coverSearch } = await import("./workflows/cover");
      await db.update(coverRequests).set({ status: "searching" }).where(eq(coverRequests.id, String(action.coverRequestId)));
      await coverSearch(String(action.coverRequestId), { incentive: Number(action.amount) });
      break;
    }
    case "cover.lead": {
      const { coverLead } = await import("./workflows/cover");
      await coverLead(String(action.coverRequestId));
      break;
    }
    case "cover.run_short": {
      const { coverRunShort } = await import("./workflows/cover");
      await coverRunShort(String(action.coverRequestId));
      break;
    }
    case "announcement.send": {
      for (const outletId of action.outletIds as string[]) {
        const g = await groupConv(outletId);
        if (g) await sendMessage({ orgId: ap.orgId, conversationId: g.id, payload: wa.text(`📣 ${String(action.text)}`), privacy: { purpose: "broadcast" }, auditTitle: "Posted an approved announcement" });
      }
      break;
    }
    default:
      await audit(ap.orgId, { runId: ap.runId, kind: "decision", title: `Nothing to execute for ${action.type}` });
  }
  await emit(ap.orgId, "approval.decided", { approvalId: ap.id });
}
