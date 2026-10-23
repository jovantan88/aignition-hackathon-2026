import { ImageResponse } from "next/og";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, workers } from "@/db/schema";
import { now } from "@/lib/clock";
import { addDays, fmtDay, localParts } from "@/lib/time";

/** A clearly-labelled SAMPLE medical certificate for the demo, personalised to the phone's owner */
export async function GET(req: Request) {
  const conv = new URL(req.url).searchParams.get("conv") ?? "";
  const c = await db.query.conversations.findFirst({ where: eq(conversations.id, conv) });
  const w = c?.workerId ? await db.query.workers.findFirst({ where: eq(workers.id, c.workerId) }) : null;
  const today = localParts(await now(c?.orgId ?? "org_kopilab")).date;
  const from = today;
  const to = addDays(today, 1);
  const name = (w?.name ?? "Sample Patient").toUpperCase();
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#FFFFFF", padding: "48px 56px", fontFamily: "serif", color: "#1a1a1a", position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #1a1a1a", paddingBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 34, fontWeight: 700 }}>SUNRISE FAMILY CLINIC</div>
            <div style={{ fontSize: 18, color: "#555" }}>Blk 123 Sample Ave 4 #01-01 · Tel 6000 0000</div>
          </div>
          <div style={{ fontSize: 16, color: "#555" }}>{`Ref MC-${today.replace(/-/g, "")}-07`}</div>
        </div>
        <div style={{ fontSize: 40, fontWeight: 700, marginTop: 30, letterSpacing: 2, display: "flex", justifyContent: "center" }}>MEDICAL CERTIFICATE</div>
        <div style={{ fontSize: 24, marginTop: 30, lineHeight: 1.6, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex" }}>{`This is to certify that ${name}`}</div>
          <div style={{ display: "flex" }}>{`is unfit for duty from ${fmtDay(from)} to ${fmtDay(to)} (2 days) inclusive.`}</div>
        </div>
        <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 20 }}>
            <div style={{ fontFamily: "cursive", fontSize: 30 }}>A. Lim</div>
            <div>Dr A. Lim · MCR 00000X</div>
            <div style={{ color: "#555" }}>{`Issued ${fmtDay(today)}`}</div>
          </div>
          <div style={{ display: "flex", width: 150, height: 150, borderRadius: 999, border: "4px solid #2b4c7e", color: "#2b4c7e", alignItems: "center", justifyContent: "center", fontSize: 18, textAlign: "center", transform: "rotate(-12deg)" }}>
            SUNRISE FAMILY CLINIC
          </div>
        </div>
        <div style={{ position: "absolute", top: 240, left: 120, display: "flex", fontSize: 64, fontWeight: 700, color: "rgba(255,79,26,0.18)", transform: "rotate(-18deg)", letterSpacing: 6 }}>SAMPLE · DEMO ONLY</div>
      </div>
    ),
    { width: 1000, height: 640 },
  );
}
