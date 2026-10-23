import { seedDemo } from "@/db/seed";
import { invalidateClock } from "@/lib/clock";

export const maxDuration = 120;

export async function POST() {
  await seedDemo();
  invalidateClock();
  return Response.json({ ok: true });
}
