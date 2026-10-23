import type { OrgSettings, Persona } from "./schema";

export const DEFAULT_SETTINGS: OrgSettings = {
  broadcastApprovalThreshold: 5,
  incentiveCapPerHour: 1,
  offerTimeoutSameDayMin: 20,
  offerTimeoutFutureMin: 240,
  waveSize: 3,
  urgentWaveSize: 5,
  maxWaves: 3,
  quietStart: "23:00",
  quietEnd: "07:30",
  autoApproveSwaps: true,
  autoApproveCoverOffers: true,
  requireMcPhoto: true,
  reminderHours: [24, 40],
  tone: "Warm, brief and practical. Sound like a friendly shift lead, not a bot. Light Singlish is fine if the worker uses it.",
  baselines: {
    availabilityAsk: 3, // compose + send + chase one person
    availabilityParse: 2, // read reply and type it into the sheet
    reminder: 1.5,
    rosterBuildPerOutlet: 45,
    rosterPublishPerPerson: 1,
    coverSearch: 35, // calls/texts to find a replacement
    question: 2,
    escalationPrep: 10,
    swap: 12,
    confirmChase: 1,
  },
  faq: [
    { q: "Pay rate", a: "Base rate is on your contract (usually $11–13/h). Sundays and public holidays are paid 1.5x. Pay is credited on the 7th of each month." },
    { q: "MC / sick leave", a: "Tell ShiftPilot as early as you can. Send a photo of your MC within 2 days. Part-timers on contract for 3+ months get paid sick leave." },
    { q: "Dress code", a: "Black top, dark jeans or pants, covered shoes. Apron and cap are provided at the outlet." },
    { q: "Meal break", a: "30-minute unpaid break for shifts of 6 hours or more, plus one free drink per shift." },
    { q: "Swapping shifts", a: "You can swap with anyone who has the same skill. Ask ShiftPilot and it will arrange it." },
    { q: "Lateness", a: "If you're running late, message ShiftPilot with your ETA so the outlet lead knows." },
  ],
};

export type OutletSeed = { code: string; name: string; address: string; lat: number; lng: number; open: string; close: string; lead: string; cbd?: boolean; busy?: boolean };

export const KOPI_OUTLETS: OutletSeed[] = [
  { code: "TPN", name: "Tampines Hub", address: "1 Tampines Walk, #01-21, Our Tampines Hub", lat: 1.35318, lng: 103.94043, open: "07:00", close: "22:00", lead: "Steven Chia", busy: true },
  { code: "JUR", name: "Jurong East", address: "50 Jurong Gateway Rd, #01-12, JEM", lat: 1.33325, lng: 103.74318, open: "07:00", close: "22:00", lead: "Nora Salleh", busy: true },
  { code: "ORC", name: "Orchard", address: "290 Orchard Rd, #B1-08, Paragon", lat: 1.30388, lng: 103.83584, open: "07:00", close: "22:00", lead: "Desmond Yap", cbd: true, busy: true },
  { code: "BSH", name: "Bishan", address: "9 Bishan Pl, #02-14, Junction 8", lat: 1.35064, lng: 103.84877, open: "07:00", close: "22:00", lead: "Carol Heng" },
  { code: "PGL", name: "Punggol", address: "83 Punggol Central, #01-40, Waterway Point", lat: 1.40653, lng: 103.90219, open: "07:00", close: "22:00", lead: "Imran Yusof" },
  { code: "TJP", name: "Tanjong Pagar", address: "7 Wallich St, #01-05, Guoco Tower", lat: 1.27652, lng: 103.84574, open: "07:00", close: "22:00", lead: "Eileen Toh", cbd: true },
];

export const SUNNY_OUTLETS: OutletSeed[] = [
  { code: "TPY", name: "Toa Payoh Central", address: "190 Lor 6 Toa Payoh, #01-542", lat: 1.33236, lng: 103.84732, open: "06:00", close: "21:00", lead: "Mrs Lim Bee Hoon" },
];

export type TemplateSeed = { dows: number[]; label: string; start: string; end: string; skill: string; headcount: number; onlyCbd?: boolean; busyHeadcount?: number };

export const KOPI_TEMPLATES: TemplateSeed[] = [
  { dows: [0, 1, 2, 3, 4], label: "Opening", start: "07:00", end: "13:00", skill: "barista", headcount: 1 },
  { dows: [0, 1, 2, 3, 4], label: "Lunch peak", start: "11:00", end: "15:00", skill: "cashier", headcount: 1, onlyCbd: true },
  { dows: [0, 1, 2, 3, 4], label: "Closing", start: "17:00", end: "22:00", skill: "barista", headcount: 1 },
  { dows: [5, 6], label: "Opening", start: "08:00", end: "14:00", skill: "barista", headcount: 1 },
  { dows: [5, 6], label: "Lunch peak", start: "11:00", end: "16:00", skill: "cashier", headcount: 1, busyHeadcount: 2 },
  { dows: [5, 6], label: "Closing", start: "16:00", end: "22:00", skill: "barista", headcount: 1 },
];

export const SUNNY_TEMPLATES: TemplateSeed[] = [
  { dows: [0, 1, 2, 3, 4, 5, 6], label: "Bake", start: "06:00", end: "12:00", skill: "kitchen", headcount: 1 },
  { dows: [0, 1, 2, 3, 4, 5, 6], label: "Counter AM", start: "10:00", end: "16:00", skill: "cashier", headcount: 1 },
  { dows: [0, 1, 2, 3, 4], label: "Counter PM", start: "16:00", end: "21:00", skill: "cashier", headcount: 1 },
  { dows: [5, 6], label: "Counter PM", start: "15:00", end: "21:00", skill: "cashier", headcount: 2 },
];

export const AREAS: Record<string, { lat: number; lng: number }> = {
  Tampines: { lat: 1.3496, lng: 103.9568 },
  "Pasir Ris": { lat: 1.3721, lng: 103.9474 },
  Bedok: { lat: 1.3236, lng: 103.9273 },
  "Jurong East": { lat: 1.3329, lng: 103.7436 },
  "Jurong West": { lat: 1.3404, lng: 103.709 },
  "Boon Lay": { lat: 1.3386, lng: 103.706 },
  Clementi: { lat: 1.3162, lng: 103.7649 },
  "Bukit Batok": { lat: 1.359, lng: 103.7637 },
  Novena: { lat: 1.3204, lng: 103.8438 },
  "River Valley": { lat: 1.2942, lng: 103.8283 },
  Bishan: { lat: 1.3508, lng: 103.8485 },
  "Ang Mo Kio": { lat: 1.3691, lng: 103.8454 },
  "Toa Payoh": { lat: 1.3343, lng: 103.8563 },
  Punggol: { lat: 1.4043, lng: 103.9021 },
  Sengkang: { lat: 1.3868, lng: 103.8914 },
  Hougang: { lat: 1.3612, lng: 103.8863 },
  "Tanjong Pagar": { lat: 1.2764, lng: 103.8458 },
  Outram: { lat: 1.2803, lng: 103.8396 },
  Queenstown: { lat: 1.2942, lng: 103.7861 },
  "Bukit Merah": { lat: 1.2819, lng: 103.8239 },
  Woodlands: { lat: 1.4382, lng: 103.789 },
  Yishun: { lat: 1.4304, lng: 103.8354 },
  Serangoon: { lat: 1.3554, lng: 103.8679 },
};

const DAY: Record<string, number> = { mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6 };
const BLK = { m: "morning", a: "afternoon", e: "evening" } as const;

/** "mo,we,fr:ae sa:ma su:mae" -> pattern */
export function pattern(spec: string): Persona["pattern"] {
  const out: Persona["pattern"] = {};
  for (const part of spec.trim().split(/\s+/)) {
    const [days, blocks] = part.split(":");
    for (const d of days.split(",")) {
      out[String(DAY[d])] = blocks.split("").map((b) => BLK[b as keyof typeof BLK]);
    }
  }
  return out;
}

export type WorkerSeed = {
  key: string;
  name: string;
  area: keyof typeof AREAS | string;
  home: string; // outlet code
  occupation: string;
  skills: string[];
  desired: number;
  max: number;
  rate: number;
  language: string;
  rel: number;
  resp: number;
  pattern: string;
  style: string;
  bio: string;
  quirks?: string[];
  memories?: { kind: "fact" | "preference" | "constraint" | "relationship" | "behaviour"; content: string; expires?: string }[];
  likes?: string[];
  avoids?: string[];
  stage?: boolean; // human-driven on the stage phones by default
  late90?: number;
  pickups90?: number;
};

export const KOPI_WORKERS: WorkerSeed[] = [
  {
    key: "mei", name: "Mei Lin Tan", area: "Jurong West", home: "JUR", occupation: "Poly student (Ngee Ann)", skills: ["barista", "cashier"],
    desired: 16, max: 24, rate: 11, language: "en", rel: 0.92, resp: 0.8, pattern: "tu,th:e sa,su:mae",
    style: "lowercase singlish, short bursts, 'can', 'lah', 'sia', uses 🙏 and 😭",
    bio: "19, second-year poly student, works Jurong mostly, very dependable, gets anxious about letting people down.",
    memories: [
      { kind: "relationship", content: "Works well with Hafiz on Jurong closing shifts" },
      { kind: "constraint", content: "Last bus home ~11:30pm, so closing at Jurong is fine but not further outlets" },
    ],
    likes: ["hafiz"], stage: true, pickups90: 3,
  },
  {
    key: "ravi", name: "Ravi Kumar", area: "Boon Lay", home: "JUR", occupation: "Undergrad (NTU)", skills: ["barista", "cashier"],
    desired: 20, max: 28, rate: 11.5, language: "en", rel: 0.95, resp: 0.92, pattern: "mo,we,fr:ae sa:ma su:mae",
    style: "polite, full sentences, replies fast, sometimes adds 'no worries!'",
    bio: "22, NTU engineering, saving for exchange, likes extra shifts.",
    memories: [
      { kind: "preference", content: "Happy to pick up last-minute cover shifts, especially Jurong or Orchard" },
      { kind: "constraint", content: "NTU finals 23 Nov – 4 Dec, keep him off weekday shifts then", expires: "2026-12-04" },
    ],
    stage: true, pickups90: 6,
  },
  {
    key: "aisha", name: "Aisha Rahman", area: "Tampines", home: "TPN", occupation: "Homemaker", skills: ["cashier", "barista"],
    desired: 18, max: 24, rate: 11, language: "en", rel: 0.9, resp: 0.75, pattern: "mo,tu,we,th,fr:ma",
    style: "friendly, 'ok noted', 'insyaAllah', occasional typos",
    bio: "38, two kids in primary school, works while they're in school.",
    memories: [
      { kind: "constraint", content: "Doesn't work weekends (family time)" },
      { kind: "preference", content: "Prefers Tampines, can do Punggol if needed" },
    ],
    stage: true,
  },
  {
    key: "junwei", name: "Jun Wei Lim", area: "Bishan", home: "BSH", occupation: "Undergrad (NUS)", skills: ["barista"],
    desired: 14, max: 20, rate: 11, language: "en", rel: 0.85, resp: 0.6, pattern: "tu,th:mae sa:e su:ae",
    style: "terse, 'ok', 'sure', 'noted', no punctuation",
    bio: "21, NUS comp sci, timetable changes often between terms.",
    memories: [{ kind: "fact", content: "Semester timetable: lectures Mon/Wed/Fri" }],
  },
  {
    key: "marcus", name: "Marcus Wong", area: "Punggol", home: "PGL", occupation: "Waiting for NS", skills: ["barista", "cashier"],
    desired: 24, max: 32, rate: 10.5, language: "en", rel: 0.72, resp: 0.45, pattern: "mo,tu,we:mae th,fr:ae sa,su:ae",
    style: "casual, 'yo', 'bro', 'can can', replies late at night",
    bio: "18, finished A-levels, enlisting in January, wants max hours.",
    memories: [
      { kind: "behaviour", content: "Late twice in the last month (5–15 min), both opening shifts" },
      { kind: "fact", content: "Enlists for NS on 12 Jan 2027", expires: "2027-01-12" },
    ],
    late90: 2,
  },
  {
    key: "uncletan", name: "Tan Ah Kow", area: "Toa Payoh", home: "BSH", occupation: "Retiree", skills: ["cashier"],
    desired: 15, max: 20, rate: 11, language: "zh", rel: 0.97, resp: 0.7, pattern: "mo,tu,we,th,fr,sa:ma",
    style: "writes in simple Chinese mixed with a bit of English, very polite, '好的', 'ok can'",
    bio: "67, retired bus captain, likes the morning crowd.",
    memories: [
      { kind: "preference", content: "Prefers messages in Chinese" },
      { kind: "constraint", content: "Knee issue: no shifts longer than 6 hours" },
    ],
  },
  {
    key: "syafiqah", name: "Nur Syafiqah", area: "Woodlands", home: "BSH", occupation: "ITE student", skills: ["cashier"],
    desired: 12, max: 20, rate: 10, language: "en", rel: 0.88, resp: 0.7, pattern: "we,fr:e sa:ae su:ma",
    style: "Malay-English mix, 'boleh', 'tq', 'sorry ya'", bio: "18, ITE hospitality, commutes from Woodlands.",
  },
  {
    key: "daniel", name: "Daniel Lee", area: "Bukit Merah", home: "TJP", occupation: "Freelance designer", skills: ["barista"],
    desired: 16, max: 24, rate: 12, language: "en", rel: 0.9, resp: 0.85, pattern: "mo,we,fr:ma sa:mae",
    style: "proper sentences, slightly formal", bio: "29, freelance designer, mornings are free.",
  },
  {
    key: "chloe", name: "Chloe Ng", area: "Novena", home: "ORC", occupation: "Undergrad (SMU)", skills: ["cashier", "barista"],
    desired: 14, max: 20, rate: 11, language: "en", rel: 0.85, resp: 0.85, pattern: "mo,th:ae sa:ae",
    style: "bubbly, lots of emojis ✨🥹, 'heyy'", bio: "20, SMU business, works Orchard.",
    memories: [{ kind: "relationship", content: "Asked not to be paired with Jasper on closing (manager noted in Sep)" }],
    avoids: ["jasper"],
  },
  {
    key: "hafiz", name: "Hafiz Ismail", area: "Jurong East", home: "JUR", occupation: "ITE student", skills: ["barista"],
    desired: 16, max: 22, rate: 10, language: "en", rel: 0.8, resp: 0.6, pattern: "we,fr:e sa:e su:mae",
    style: "short, 'ok bro', 'on the way'", bio: "19, ITE, lives near JEM.", likes: ["mei"],
  },
  {
    key: "grace", name: "Grace Teo", area: "Tampines", home: "TPN", occupation: "Undergrad (SUTD)", skills: ["cashier"],
    desired: 12, max: 18, rate: 11, language: "en", rel: 0.9, resp: 0.8, pattern: "fr:e sa,su:ma",
    style: "neat, uses full stops", bio: "20, SUTD, weekends mostly.",
  },
  {
    key: "kavitha", name: "Kavitha Raj", area: "Bedok", home: "TPN", occupation: "Homemaker", skills: ["cashier", "barista"],
    desired: 20, max: 24, rate: 11.5, language: "en", rel: 0.95, resp: 0.85, pattern: "mo,tu,we,th,fr:ma sa:m",
    style: "warm, 'sure dear', clear answers", bio: "42, kids in secondary school.",
    memories: [{ kind: "fact", content: "Kids' school holidays start 21 Nov, more availability after that", expires: "2026-12-31" }],
  },
  {
    key: "ethan", name: "Ethan Goh", area: "Sengkang", home: "PGL", occupation: "JC student", skills: ["barista"],
    desired: 10, max: 16, rate: 10, language: "en", rel: 0.78, resp: 0.5, pattern: "fr:e sa,su:mae",
    style: "lowercase, 'ya can', 'idk'", bio: "18, JC2.",
    memories: [{ kind: "constraint", content: "A-level papers until 20 Nov: weekends only", expires: "2026-11-20" }],
  },
  {
    key: "farah", name: "Farah Aziz", area: "Punggol", home: "PGL", occupation: "Poly student (SP)", skills: ["cashier", "barista"],
    desired: 16, max: 20, rate: 10.5, language: "en", rel: 0.87, resp: 0.75, pattern: "mo,we:e sa,su:ae",
    style: "friendly, 'okiee', 'thank youu'", bio: "19, Singapore Poly.",
  },
  {
    key: "benjamin", name: "Benjamin Tay", area: "Clementi", home: "JUR", occupation: "Undergrad (NUS)", skills: ["cashier", "barista"],
    desired: 18, max: 24, rate: 11, language: "en", rel: 0.9, resp: 0.8, pattern: "tu,th:ma sa,su:ma",
    style: "concise, 'Sure, noted.'", bio: "22, NUS econs.",
  },
  {
    key: "siewling", name: "Ho Siew Ling", area: "Ang Mo Kio", home: "BSH", occupation: "Homemaker", skills: ["barista", "cashier"],
    desired: 18, max: 22, rate: 11.5, language: "en", rel: 0.93, resp: 0.8, pattern: "mo,tu,we,th,fr:ma",
    style: "polite, mixes in '可以' sometimes", bio: "45, ex-cafe owner.",
  },
  {
    key: "arjun", name: "Arjun Menon", area: "Novena", home: "ORC", occupation: "Undergrad (SMU)", skills: ["barista"],
    desired: 14, max: 20, rate: 11, language: "en", rel: 0.86, resp: 0.8, pattern: "tu,we:e su:mae",
    style: "chill, 'sounds good'", bio: "21, SMU law.",
  },
  {
    key: "huimin", name: "Chua Hui Min", area: "Toa Payoh", home: "ORC", occupation: "Retired teacher", skills: ["cashier"],
    desired: 15, max: 18, rate: 11.5, language: "en", rel: 0.96, resp: 0.9, pattern: "mo,tu,we,th,fr:ma",
    style: "proper English, signs off with 'Thank you.'", bio: "63, retired teacher.",
    memories: [{ kind: "preference", content: "Prefers cashier over barista" }],
  },
  {
    key: "zul", name: "Zulkifli Hakim", area: "Bedok", home: "TPN", occupation: "Private-hire driver", skills: ["barista", "cashier"],
    desired: 20, max: 30, rate: 11, language: "en", rel: 0.8, resp: 0.9, pattern: "mo,tu,we,th,fr:ma su:mae",
    style: "short, 'can bro', 'otw'", bio: "34, drives private hire, flexible mornings.",
    memories: [{ kind: "preference", content: "Good for last-minute morning cover (drives, can reach any outlet fast)" }],
    pickups90: 4,
  },
  {
    key: "rachel", name: "Rachel Lim", area: "Queenstown", home: "TJP", occupation: "Undergrad (NUS)", skills: ["cashier", "barista"],
    desired: 16, max: 22, rate: 11, language: "en", rel: 0.9, resp: 0.85, pattern: "mo,th:ae sa:mae",
    style: "upbeat, 'yesss can!'", bio: "21, NUS arts.",
  },
  {
    key: "weijie", name: "Koh Wei Jie", area: "Bukit Batok", home: "JUR", occupation: "Poly student (TP)", skills: ["barista"],
    desired: 14, max: 20, rate: 10.5, language: "en", rel: 0.82, resp: 0.6, pattern: "mo,fr:e sa:ae",
    style: "'ok', 'can', slow replies", bio: "19, Temasek Poly.",
  },
  {
    key: "amanda", name: "Amanda Sim", area: "Hougang", home: "PGL", occupation: "Homemaker", skills: ["cashier"],
    desired: 16, max: 20, rate: 11, language: "en", rel: 0.91, resp: 0.8, pattern: "tu,we,th,fr:ma",
    style: "polite, 'Noted with thanks'", bio: "40, toddler in childcare.",
  },
  {
    key: "irfan", name: "Irfan Saleh", area: "Tampines", home: "TPN", occupation: "NSF (weekends)", skills: ["barista", "cashier"],
    desired: 12, max: 16, rate: 10.5, language: "en", rel: 0.88, resp: 0.5, pattern: "sa,su:mae",
    style: "'roger', short", bio: "20, serving NS, books out on weekends.",
  },
  {
    key: "joanne", name: "Joanne Yeo", area: "Bishan", home: "BSH", occupation: "Freelance writer", skills: ["barista", "cashier"],
    desired: 20, max: 26, rate: 12, language: "en", rel: 0.9, resp: 0.85, pattern: "mo,we,fr:mae su:m",
    style: "chatty, full sentences", bio: "31, freelance writer.",
  },
  {
    key: "kelvin", name: "Kelvin Ong", area: "Outram", home: "TJP", occupation: "Part-time degree (SUSS)", skills: ["barista"],
    desired: 16, max: 24, rate: 11, language: "en", rel: 0.87, resp: 0.75, pattern: "mo,tu,we,th:e sa:ma",
    style: "brief, 'ok noted'", bio: "26, studying part-time at night some days.",
  },
  {
    key: "nadia", name: "Nadia Hamid", area: "Jurong West", home: "JUR", occupation: "Homemaker", skills: ["cashier"],
    desired: 15, max: 20, rate: 11, language: "en", rel: 0.94, resp: 0.8, pattern: "mo,tu,we,th:ma",
    style: "kind, 'InsyaAllah can'", bio: "36, three kids.",
  },
  {
    key: "samuel", name: "Samuel Chen", area: "Pasir Ris", home: "TPN", occupation: "JC student", skills: ["cashier"],
    desired: 10, max: 14, rate: 10, language: "en", rel: 0.8, resp: 0.55, pattern: "sa,su:ae",
    style: "'yep', 'ok'", bio: "17, JC1.",
  },
  {
    key: "divya", name: "Divya Pillai", area: "Serangoon", home: "BSH", occupation: "Undergrad (NTU)", skills: ["cashier", "barista"],
    desired: 14, max: 20, rate: 11, language: "en", rel: 0.9, resp: 0.8, pattern: "tu,th:e sa,su:ma",
    style: "organised, lists days clearly", bio: "20, NTU, stays home on weekends.",
  },
  {
    key: "lucas", name: "Lucas Tan", area: "Punggol", home: "PGL", occupation: "Poly student (NYP)", skills: ["barista"],
    desired: 14, max: 20, rate: 10.5, language: "en", rel: 0.76, resp: 0.5, pattern: "tu,th:e su:mae",
    style: "'k', 'can', rarely capitalises", bio: "18, NYP.",
  },
  {
    key: "michelle", name: "Michelle Low", area: "River Valley", home: "ORC", occupation: "Homemaker (expat spouse)", skills: ["barista", "cashier"],
    desired: 18, max: 24, rate: 12, language: "en", rel: 0.92, resp: 0.85, pattern: "mo,tu,we,th,fr:ma",
    style: "cheerful, British spelling", bio: "35, moved from London last year.",
  },
  {
    key: "firdaus", name: "Ahmad Firdaus", area: "Yishun", home: "BSH", occupation: "ITE student", skills: ["cashier"],
    desired: 12, max: 18, rate: 10, language: "en", rel: 0.8, resp: 0.6, pattern: "mo,we,fr:e sa:ae",
    style: "'ok can', 'sorry late reply'", bio: "18, ITE.",
  },
  {
    key: "valerie", name: "Valerie Chong", area: "Bukit Merah", home: "TJP", occupation: "Undergrad (SMU)", skills: ["barista", "cashier"],
    desired: 16, max: 20, rate: 11, language: "en", rel: 0.91, resp: 0.8, pattern: "tu,th,fr:ae su:a",
    style: "precise, gives exact times", bio: "21, SMU accountancy.",
  },
  {
    key: "gopal", name: "Gopal Krishnan", area: "Toa Payoh", home: "BSH", occupation: "Retiree", skills: ["cashier"],
    desired: 12, max: 16, rate: 11, language: "en", rel: 0.95, resp: 0.7, pattern: "mo,tu,we,th,fr:ma",
    style: "formal, 'Good morning. Noted.'", bio: "66, retired civil servant.",
  },
  {
    key: "tiffany", name: "Tiffany Ho", area: "Tampines", home: "TPN", occupation: "Poly student (TP)", skills: ["cashier", "barista"],
    desired: 14, max: 20, rate: 10.5, language: "en", rel: 0.85, resp: 0.75, pattern: "mo,we,fr:e sa:mae",
    style: "'can!!', emojis", bio: "18, Temasek Poly.",
  },
  {
    key: "bryan", name: "Bryan Lau", area: "Jurong East", home: "JUR", occupation: "Undergrad (SIT)", skills: ["barista", "cashier"],
    desired: 16, max: 22, rate: 11, language: "en", rel: 0.9, resp: 0.8, pattern: "mo,tu:e sa:ma",
    style: "straightforward", bio: "22, SIT.",
  },
  {
    key: "sharifah", name: "Sharifah Noor", area: "Punggol", home: "PGL", occupation: "Homemaker", skills: ["cashier", "barista"],
    desired: 18, max: 22, rate: 11.5, language: "en", rel: 0.93, resp: 0.85, pattern: "mo,tu,we,th,fr:ma",
    style: "warm, 'Alhamdulillah', clear", bio: "39.",
  },
  {
    key: "jasper", name: "Jasper Quek", area: "Novena", home: "ORC", occupation: "Gap year", skills: ["barista", "cashier"],
    desired: 22, max: 30, rate: 10.5, language: "en", rel: 0.84, resp: 0.7, pattern: "mo,tu,we,th,fr:ae sa,su:ae",
    style: "casual, 'sure thing'", bio: "19, gap year before uni.",
  },
  {
    key: "yuki", name: "Yuki Tanaka", area: "River Valley", home: "ORC", occupation: "Exchange student (NUS)", skills: ["cashier"],
    desired: 10, max: 16, rate: 11, language: "en", rel: 0.9, resp: 0.8, pattern: "sa,su:ma",
    style: "polite, careful English", bio: "21, on exchange till May.",
  },
  {
    key: "hannah", name: "Hannah Lim", area: "Bishan", home: "BSH", occupation: "JC student", skills: ["cashier"],
    desired: 10, max: 14, rate: 10, language: "en", rel: 0.82, resp: 0.6, pattern: "sa,su:ae",
    style: "'okie'", bio: "17, JC1.",
  },
  {
    key: "uncleong", name: "Ong Boon Huat", area: "Jurong West", home: "JUR", occupation: "Retiree (ex-kopitiam)", skills: ["barista"],
    desired: 18, max: 24, rate: 12, language: "zh", rel: 0.97, resp: 0.6, pattern: "mo,tu,we,th,fr,sa:ma",
    style: "simple Chinese or broken English, 'ok can', 'no problem 啦'", bio: "64, pulled kopi for 30 years.",
    memories: [{ kind: "fact", content: "Regulars at Jurong ask for his kopi by name" }],
  },
  {
    key: "clara", name: "Clara Fernandez", area: "Bedok", home: "TPN", occupation: "Freelance tutor", skills: ["barista", "cashier"],
    desired: 16, max: 22, rate: 11.5, language: "en", rel: 0.9, resp: 0.8, pattern: "tu,th:mae su:e",
    style: "friendly, 'cheers'", bio: "33, tutors in the evenings on Mon/Wed.",
  },
  {
    key: "faisal", name: "Faisal Rahim", area: "Tanjong Pagar", home: "TJP", occupation: "Undergrad (SMU)", skills: ["cashier", "barista"],
    desired: 14, max: 20, rate: 11, language: "en", rel: 0.88, resp: 0.8, pattern: "mo,we:ae fr:ma",
    style: "brief, 'noted bro'", bio: "22, lives near the outlet.",
  },
  {
    key: "natalie", name: "Natalie Chan", area: "Sengkang", home: "PGL", occupation: "Poly student (NYP)", skills: ["cashier", "barista"],
    desired: 14, max: 20, rate: 10.5, language: "en", rel: 0.89, resp: 0.8, pattern: "th:e sa,su:mae",
    style: "cheerful, 'can can!'", bio: "18, NYP, weekends free.",
  },
  {
    key: "imran", name: "Imran Shah", area: "Bukit Merah", home: "TJP", occupation: "Undergrad (NUS)", skills: ["cashier", "barista"],
    desired: 14, max: 20, rate: 11, language: "en", rel: 0.9, resp: 0.8, pattern: "we:e sa,su:mae",
    style: "short and polite", bio: "21, NUS, lives near Tiong Bahru.",
  },
  {
    key: "josephine", name: "Josephine Lee", area: "Bishan", home: "BSH", occupation: "Office admin (weekends)", skills: ["cashier"],
    desired: 12, max: 16, rate: 11, language: "en", rel: 0.93, resp: 0.85, pattern: "sa,su:ma",
    style: "neat, 'Noted, thanks!'", bio: "28, weekday office job.",
  },
  {
    key: "keith", name: "Keith Ng", area: "Hougang", home: "PGL", occupation: "Uni student (SUSS)", skills: ["barista", "cashier"],
    desired: 14, max: 20, rate: 11, language: "en", rel: 0.86, resp: 0.7, pattern: "tu:e sa,su:ae",
    style: "'ok sure'", bio: "23.",
  },
];

export const SUNNY_WORKERS: WorkerSeed[] = [
  { key: "s_lena", name: "Lena Koh", area: "Toa Payoh", home: "TPY", occupation: "Homemaker", skills: ["kitchen", "cashier"], desired: 24, max: 30, rate: 11, language: "en", rel: 0.95, resp: 0.8, pattern: "mo,tu,we,th,fr,sa:ma", style: "kind and brief", bio: "41, bakes at home too." },
  { key: "s_hakim", name: "Hakim Osman", area: "Toa Payoh", home: "TPY", occupation: "Poly student", skills: ["cashier"], desired: 14, max: 20, rate: 10.5, language: "en", rel: 0.85, resp: 0.7, pattern: "mo,we,fr:ae sa,su:ae", style: "'ok can'", bio: "19." },
  { key: "s_janice", name: "Janice Tan", area: "Novena", home: "TPY", occupation: "Undergrad", skills: ["cashier", "kitchen"], desired: 16, max: 20, rate: 11, language: "en", rel: 0.9, resp: 0.8, pattern: "tu,th:mae su:ma", style: "neat", bio: "21." },
  { key: "s_mdm", name: "Wong Mei Fong", area: "Toa Payoh", home: "TPY", occupation: "Retiree", skills: ["kitchen"], desired: 18, max: 24, rate: 11.5, language: "zh", rel: 0.97, resp: 0.6, pattern: "mo,tu,we,th,fr,sa,su:m", style: "Chinese, polite", bio: "62." },
  { key: "s_ryan", name: "Ryan Lim", area: "Bishan", home: "TPY", occupation: "JC student", skills: ["cashier"], desired: 10, max: 14, rate: 10, language: "en", rel: 0.8, resp: 0.5, pattern: "sa,su:ae fr:e", style: "'k'", bio: "17." },
  { key: "s_anita", name: "Anita Das", area: "Serangoon", home: "TPY", occupation: "Freelancer", skills: ["cashier", "kitchen"], desired: 18, max: 24, rate: 11, language: "en", rel: 0.9, resp: 0.85, pattern: "mo,tu,we,th,fr:ae", style: "friendly", bio: "30." },
  { key: "s_kenji", name: "Kenji Ong", area: "Ang Mo Kio", home: "TPY", occupation: "Uni student", skills: ["cashier"], desired: 12, max: 18, rate: 10.5, language: "en", rel: 0.86, resp: 0.7, pattern: "mo,we:e sa,su:ma", style: "'sure'", bio: "20." },
];

export const KOPI = {
  id: "org_kopilab",
  name: "Kopi Lab",
  slug: "kopilab",
  managerName: "Priya Nair",
  managerPhone: "+65 9123 4567",
  brandColor: "#16130F",
};

export const SUNNY = {
  id: "org_sunnyside",
  name: "Sunny Side Bakery",
  slug: "sunnyside",
  managerName: "Lim Bee Hoon",
  managerPhone: "+65 9876 5432",
  brandColor: "#C98A0B",
};
