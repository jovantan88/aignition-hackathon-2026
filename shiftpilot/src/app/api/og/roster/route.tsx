import { ImageResponse } from "next/og";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { orgs, outlets, shifts, workers } from "@/db/schema";
import { DOW_SHORT, addDays, dowOf, fmtShiftRange, fmtShortDate, isoWeek } from "@/lib/time";

/** Roster card sent as the image header of the roster message */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const workerId = url.searchParams.get("worker") ?? "";
  const week = url.searchParams.get("week") ?? "";
  const w = await db.query.workers.findFirst({ where: eq(workers.id, workerId) });
  if (!w || !week) return new Response("not found", { status: 404 });
  const org = await db.query.orgs.findFirst({ where: eq(orgs.id, w.orgId) });
  const rows = await db
    .select({ s: shifts, outlet: outlets.name, code: outlets.code })
    .from(shifts)
    .innerJoin(outlets, eq(outlets.id, shifts.outletId))
    .where(and(eq(shifts.workerId, w.id), gte(shifts.date, week), lte(shifts.date, addDays(week, 6)), inArray(shifts.status, ["assigned", "confirmed", "draft", "covered", "completed"])))
    .orderBy(asc(shifts.startsAt));
  const hours = rows.reduce((h, r) => h + (r.s.endsAt.getTime() - r.s.startsAt.getTime()) / 3_600_000, 0);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#F3EFE6", color: "#16130F", padding: "44px 52px", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "3px solid #16130F", paddingBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 40, height: 40, background: "#16130F", borderRadius: 9, display: "flex", alignItems: "flex-start", justifyContent: "flex-end", padding: 6 }}>
              <div style={{ width: 11, height: 11, borderRadius: 99, background: "#FF4F1A" }} />
            </div>
            <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.5 }}>{org?.name ?? "ShiftPilot"}</div>
          </div>
          <div style={{ fontSize: 22, letterSpacing: 3, color: "#6B655C" }}>{`WEEK ${isoWeek(week)} · ${fmtShortDate(week).toUpperCase()}`}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 26 }}>
          <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: -1.5 }}>{w.name}</div>
          <div style={{ fontSize: 26, color: "#6B655C" }}>{`${rows.length} shifts · ${Math.round(hours)}h`}</div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 30 }}>
          {days.map((d) => {
            const mine = rows.filter((r) => r.s.date === d);
            return (
              <div key={d} style={{ flex: 1, display: "flex", flexDirection: "column", borderTop: mine.length ? "6px solid #FF4F1A" : "6px solid #D6CFC2", paddingTop: 12, minHeight: 210 }}>
                <div style={{ fontSize: 20, letterSpacing: 2, color: "#6B655C" }}>{DOW_SHORT[dowOf(d)].toUpperCase()}</div>
                <div style={{ fontSize: 34, fontWeight: 700 }}>{d.slice(8)}</div>
                {mine.map((r) => (
                  <div key={r.s.id} style={{ display: "flex", flexDirection: "column", marginTop: 10, background: "#16130F", color: "#F3EFE6", padding: "10px 10px", borderRadius: 4 }}>
                    <div style={{ fontSize: 19, fontWeight: 700 }}>{fmtShiftRange(r.s.startsAt, r.s.endsAt)}</div>
                    <div style={{ fontSize: 16, opacity: 0.8, marginTop: 2 }}>{`${r.code} · ${r.s.label}`}</div>
                  </div>
                ))}
                {!mine.length && <div style={{ fontSize: 17, color: "#B4AC9E", marginTop: 12 }}>off</div>}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", fontSize: 18, color: "#6B655C" }}>
          <div>{rows[0] ? `First shift: ${DOW_SHORT[dowOf(rows[0].s.date)]} ${fmtShiftRange(rows[0].s.startsAt, rows[0].s.endsAt)} at ${rows[0].outlet}` : "No shifts this week"}</div>
          <div>Sent by ShiftPilot</div>
        </div>
      </div>
    ),
    { width: 1200, height: 560, headers: { "Cache-Control": "public, max-age=60" } },
  );
}
