import { cookies } from "next/headers";

export const ORG_COOKIE = "sp_org";
export const DEFAULT_ORG = "org_kopilab";
export const ORG_IDS = ["org_kopilab", "org_sunnyside"] as const;

/** Active org for manager-side routes (no auth: demo) */
export async function activeOrgId(req?: Request) {
  const fromQuery = req ? new URL(req.url).searchParams.get("org") : null;
  if (fromQuery && (ORG_IDS as readonly string[]).includes(fromQuery)) return fromQuery;
  const c = (await cookies()).get(ORG_COOKIE)?.value;
  return c && (ORG_IDS as readonly string[]).includes(c) ? c : DEFAULT_ORG;
}
