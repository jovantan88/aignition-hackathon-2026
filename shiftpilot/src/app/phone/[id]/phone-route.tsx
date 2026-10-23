"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Phone, usePhone } from "@/components/wa/phone";
import { PersonAvatar } from "@/components/wa/avatar";

const HINTS: Record<string, string[]> = {
  worker: [
    "sorry cant come tmr, fever 🤒",
    "can i swap my sat shift with someone?",
    "mon to wed after 5 can, sat whole day, sun cannot",
    "running 15 min late, bus breakdown",
    "my new timetable got class tue thu morning until dec",
    "where is the jurong outlet ah",
    "I like working with Hafiz",
    "any extra shifts this week?",
  ],
  manager: [
    "Plan next week. Jurong has a Saturday promo, need 2 extra in the afternoon. Orchard closed Monday.",
    "Who's working at Jurong tomorrow?",
    "Why did you pick Ravi for the last cover?",
    "Mei called the store, she's sick tomorrow",
    "Tell the Tampines crew the coffee machine is being serviced Friday 3pm",
  ],
};

export function PhoneRoute() {
  const { id } = useParams<{ id: string }>();
  const { data } = usePhone(id);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 640px)");
    const f = () => setNarrow(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);

  if (narrow) return <Phone phoneId={id} framed={false} />;

  const kind = data?.identity.kind ?? "worker";
  return (
    <div className="flex min-h-dvh items-center justify-center gap-12 px-8 py-8">
      <div className="h-[min(92dvh,820px)]">
        <Phone phoneId={id} />
      </div>
      <aside className="hidden w-[300px] lg:block">
        <Link href="/phone" className="label-mono hover:text-ink">
          ← All phones
        </Link>
        {data && (
          <div className="mt-6 border-t border-ink pt-5">
            <div className="flex items-center gap-3">
              <PersonAvatar name={data.identity.name} hue={data.identity.avatarHue} size={44} />
              <div>
                <div className="font-display text-2xl leading-tight">{data.identity.name}</div>
                <div className="text-[13px] text-ink-soft">{data.identity.subtitle}</div>
              </div>
            </div>
            <dl className="mt-5 grid grid-cols-[90px_1fr] gap-y-1.5 text-[13px]">
              <dt className="label-mono pt-0.5">Org</dt>
              <dd>{data.identity.orgName}</dd>
              <dt className="label-mono pt-0.5">Phone</dt>
              <dd className="num font-mono text-[12.5px]">{data.identity.phone}</dd>
              {kind === "worker" && (
                <>
                  <dt className="label-mono pt-0.5">Mode</dt>
                  <dd>{data.identity.autopilot ? "Autopilot persona (replies on its own)" : "Stage character (you drive)"}</dd>
                </>
              )}
            </dl>
          </div>
        )}
        <div className="mt-8">
          <div className="label-mono mb-2">Try saying</div>
          <ul className="space-y-1.5">
            {HINTS[kind].map((h) => (
              <li key={h}>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(h)}
                  className="w-full border border-rule bg-card px-3 py-2 text-left text-[13px] leading-snug hover:border-ink"
                  title="Copy"
                >
                  “{h}”
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-ink-soft">Click to copy. Voice notes, photos (try the sample MC) and location sharing are in the 📎 menu.</p>
        </div>
      </aside>
    </div>
  );
}
