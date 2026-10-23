const SURNAMES = new Set(
  "tan lim lee ng ong wong goh chua chan koh teo ang yeo tay ho low toh sim chong chia seah quek lau heng yap foo liew chew".split(" "),
);

/** The name people actually call each other: "Ho Siew Ling" → "Siew Ling", "Mei Lin Tan" → "Mei Lin", "Nur Syafiqah" → "Syafiqah" */
export function firstName(full: string) {
  const parts = full.replace(/\(.*?\)/g, "").trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts[0] === "Nur") return parts[1];
  if (parts.length === 3 && SURNAMES.has(parts[0].toLowerCase()) && !SURNAMES.has(parts[2].toLowerCase())) return `${parts[1]} ${parts[2]}`;
  if (parts.length === 3 && SURNAMES.has(parts[2].toLowerCase())) return `${parts[0]} ${parts[1]}`;
  return parts[0];
}
