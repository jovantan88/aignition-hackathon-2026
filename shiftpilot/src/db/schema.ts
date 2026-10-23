import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

// ---------- shared jsonb shapes ----------

export type OrgSettings = {
  /** Broadcasts to more than this many people need approval */
  broadcastApprovalThreshold: number;
  /** Max incentive per hour the agent may offer without approval (SGD) */
  incentiveCapPerHour: number;
  /** Minutes an offer stays open for same-day / future shifts */
  offerTimeoutSameDayMin: number;
  offerTimeoutFutureMin: number;
  /** Offers per wave for normal / urgent cover */
  waveSize: number;
  urgentWaveSize: number;
  maxWaves: number;
  /** Local quiet hours (HH:MM), non-urgent messages are queued */
  quietStart: string;
  quietEnd: string;
  /** Auto-apply like-for-like swaps without approval */
  autoApproveSwaps: boolean;
  /** Cover offers within everyone's limits go out without approval */
  autoApproveCoverOffers: boolean;
  /** Ask for an MC photo when someone reports sick */
  requireMcPhoto: boolean;
  /** Reminder cadence for availability, hours after kickoff */
  reminderHours: number[];
  /** Agent tone */
  tone: string;
  /** Manual-minutes baselines for the impact page */
  baselines: Record<string, number>;
  faq: { q: string; a: string }[];
};

export type Persona = {
  /** Short description used by the persona simulator */
  bio: string;
  style: string; // how they write
  reliability: number; // 0..1
  responsiveness: number; // 0..1 (higher = replies faster)
  /** Ground-truth weekly pattern: dow (0=Mon) -> blocks */
  pattern: Record<string, ("morning" | "afternoon" | "evening")[]>;
  quirks?: string[];
};

export type WorkerStats = {
  repliesMedianMin: number;
  availabilityResponseRate: number; // 0..1
  offersReceived: number;
  offersAccepted: number;
  lateCancellations90d: number;
  lateArrivals90d: number;
  coverPickups90d: number;
  shifts90d: number;
};

export type PlanStep = {
  id: string;
  title: string;
  status: "pending" | "running" | "done" | "blocked" | "failed" | "skipped" | "waiting";
  detail?: string;
  startedAt?: string;
  endedAt?: string;
};

export type DemandOverride = {
  outletId: string;
  date?: string; // YYYY-MM-DD, or all dates if omitted
  dow?: number;
  label?: string; // template label, or all if omitted
  delta?: number; // headcount change
  closed?: boolean;
  note?: string;
};

// ---------- tables ----------

export const orgs = pgTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  timezone: text("timezone").notNull().default("Asia/Singapore"),
  brandColor: text("brand_color").notNull().default("#16130F"),
  managerName: text("manager_name").notNull(),
  managerPhone: text("manager_phone").notNull(),
  settings: jsonb("settings").$type<OrgSettings>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const outlets = pgTable(
  "outlets",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    address: text("address").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    openTime: text("open_time").notNull(),
    closeTime: text("close_time").notNull(),
    leadName: text("lead_name"),
  },
  (t) => [index("outlets_org_idx").on(t.orgId)],
);

export const workers = pgTable(
  "workers",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    homeArea: text("home_area").notNull(),
    homeLat: doublePrecision("home_lat").notNull(),
    homeLng: doublePrecision("home_lng").notNull(),
    homeOutletId: text("home_outlet_id"),
    skills: text("skills").array().notNull(),
    desiredHours: integer("desired_hours").notNull(),
    maxHours: integer("max_hours").notNull(),
    hourlyRate: real("hourly_rate").notNull(),
    language: text("language").notNull().default("en"),
    occupation: text("occupation").notNull(),
    persona: jsonb("persona").$type<Persona>().notNull(),
    stats: jsonb("stats").$type<WorkerStats>().notNull(),
    autopilot: boolean("autopilot").notNull().default(true),
    active: boolean("active").notNull().default(true),
    avatarHue: integer("avatar_hue").notNull().default(20),
    joinedAt: ts("joined_at").notNull(),
  },
  (t) => [index("workers_org_idx").on(t.orgId)],
);

export const shiftTemplates = pgTable("shift_templates", {
  id: text("id").primaryKey(),
  outletId: text("outlet_id").notNull(),
  dow: integer("dow").notNull(), // 0 = Monday
  label: text("label").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  skill: text("skill").notNull(),
  headcount: integer("headcount").notNull(),
});

export const planningCycles = pgTable(
  "planning_cycles",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    weekStart: text("week_start").notNull(), // YYYY-MM-DD (Monday)
    status: text("status")
      .$type<"draft" | "collecting" | "solving" | "negotiating" | "awaiting_approval" | "published">()
      .notNull(),
    goal: text("goal"),
    demandOverrides: jsonb("demand_overrides").$type<DemandOverride[]>().notNull().default([]),
    runId: text("run_id"),
    deadlineAt: ts("deadline_at"),
    kickoffAt: ts("kickoff_at"),
    publishedAt: ts("published_at"),
    solveSummary: jsonb("solve_summary").$type<Record<string, unknown>>(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("cycles_org_idx").on(t.orgId, t.weekStart)],
);

export const availability = pgTable(
  "availability",
  {
    id: text("id").primaryKey(),
    workerId: text("worker_id").notNull(),
    cycleId: text("cycle_id").notNull(),
    date: text("date").notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    kind: text("kind").$type<"available" | "preferred" | "maybe" | "unavailable">().notNull(),
    source: text("source").$type<"flow" | "text" | "recurring" | "manager">().notNull(),
    confidence: real("confidence").notNull().default(1),
    note: text("note"),
    sourceMessageId: text("source_message_id"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("avail_cycle_idx").on(t.cycleId, t.workerId)],
);

export const recurringConstraints = pgTable("recurring_constraints", {
  id: text("id").primaryKey(),
  workerId: text("worker_id").notNull(),
  description: text("description").notNull(),
  dows: integer("dows").array().notNull(),
  startMin: integer("start_min").notNull(),
  endMin: integer("end_min").notNull(),
  kind: text("kind").$type<"unavailable" | "preferred">().notNull(),
  validFrom: text("valid_from"),
  validTo: text("valid_to"),
  sourceMessageId: text("source_message_id"),
  createdAt: ts("created_at").notNull(),
});

export type AssignmentExplanation = {
  score: number;
  reasons: string[];
  alternatives?: { workerId: string; name: string; score: number }[];
};

export const shifts = pgTable(
  "shifts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    cycleId: text("cycle_id"),
    outletId: text("outlet_id").notNull(),
    date: text("date").notNull(),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    label: text("label").notNull(),
    skill: text("skill").notNull(),
    status: text("status")
      .$type<"draft" | "open" | "assigned" | "confirmed" | "cover_needed" | "covered" | "cancelled" | "completed">()
      .notNull(),
    workerId: text("worker_id"),
    explanation: jsonb("explanation").$type<AssignmentExplanation>(),
    source: text("source").$type<"solver" | "manual" | "cover" | "split" | "seed" | "negotiation">().notNull(),
    parentShiftId: text("parent_shift_id"),
    confirmedAt: ts("confirmed_at"),
    checkedInAt: ts("checked_in_at"),
    reminderSentAt: ts("reminder_sent_at"),
  },
  (t) => [
    index("shifts_org_date_idx").on(t.orgId, t.date),
    index("shifts_worker_idx").on(t.workerId),
    index("shifts_cycle_idx").on(t.cycleId),
  ],
);

export const coverRequests = pgTable(
  "cover_requests",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    shiftId: text("shift_id").notNull(),
    originalWorkerId: text("original_worker_id"),
    type: text("type").$type<"sick" | "emergency" | "leave" | "timetable" | "no_show" | "swap" | "shortage">().notNull(),
    reason: text("reason"), // private: never shown to candidates
    urgency: text("urgency").$type<"normal" | "urgent">().notNull(),
    status: text("status").$type<"searching" | "offered" | "filled" | "escalated" | "unfilled" | "cancelled">().notNull(),
    runId: text("run_id"),
    wave: integer("wave").notNull().default(0),
    filledBy: text("filled_by"),
    filledAt: ts("filled_at"),
    escalatedAt: ts("escalated_at"),
    resolution: jsonb("resolution").$type<Record<string, unknown>>(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("cover_org_idx").on(t.orgId, t.status)],
);

export const offers = pgTable(
  "offers",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    coverRequestId: text("cover_request_id"),
    shiftId: text("shift_id").notNull(),
    workerId: text("worker_id").notNull(),
    wave: integer("wave").notNull(),
    kind: text("kind").$type<"cover" | "shortage" | "swap" | "transfer">().notNull(),
    incentive: real("incentive").notNull().default(0),
    status: text("status").$type<"pending" | "accepted" | "declined" | "expired" | "withdrawn" | "lost">().notNull(),
    rankScore: real("rank_score"),
    rankReasons: jsonb("rank_reasons").$type<string[]>(),
    sentAt: ts("sent_at").notNull(),
    respondedAt: ts("responded_at"),
    expiresAt: ts("expires_at").notNull(),
    messageId: text("message_id"),
  },
  (t) => [index("offers_worker_idx").on(t.workerId, t.status), index("offers_cover_idx").on(t.coverRequestId)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    kind: text("kind").$type<"worker_dm" | "manager_dm" | "outlet_group">().notNull(),
    workerId: text("worker_id"),
    outletId: text("outlet_id"),
    title: text("title").notNull(),
    agentPaused: boolean("agent_paused").notNull().default(false),
    lastInboundAt: ts("last_inbound_at"),
    lastMessageAt: ts("last_message_at"),
    lastMessagePreview: text("last_message_preview"),
    processingLockUntil: ts("processing_lock_until"),
    needsAttention: boolean("needs_attention").notNull().default(false),
  },
  (t) => [index("conv_org_idx").on(t.orgId), index("conv_worker_idx").on(t.workerId)],
);

export type MessageAnnotation = {
  intent?: string;
  summary?: string;
  confidence?: number;
  tools?: string[];
  transcript?: string;
  extracted?: unknown;
  /** Why an outbound message is held: quiet hours, or the closed 24h window */
  held?: "quiet" | "window";
};

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    direction: text("direction").$type<"in" | "out">().notNull(),
    sender: text("sender").$type<"agent" | "worker" | "manager" | "system">().notNull(),
    senderWorkerId: text("sender_worker_id"),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    text: text("text").notNull().default(""),
    status: text("status").$type<"queued" | "sent" | "delivered" | "read" | "failed">().notNull(),
    contextMessageId: text("context_message_id"),
    annotation: jsonb("annotation").$type<MessageAnnotation>(),
    runId: text("run_id"),
    processedAt: ts("processed_at"),
    template: text("template"),
    createdAt: ts("created_at").notNull(),
    realCreatedAt: ts("real_created_at").notNull().defaultNow(),
  },
  (t) => [index("msg_conv_idx").on(t.conversationId, t.createdAt)],
);

export const media = pgTable("media", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  kind: text("kind").$type<"voice" | "image" | "document">().notNull(),
  mime: text("mime").notNull(),
  data: text("data").notNull(), // base64
  bytes: integer("bytes").notNull(),
  restricted: boolean("restricted").notNull().default(false),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    workerId: text("worker_id"),
    kind: text("kind").$type<"fact" | "preference" | "constraint" | "relationship" | "behaviour">().notNull(),
    content: text("content").notNull(),
    evidenceMessageId: text("evidence_message_id"),
    confidence: real("confidence").notNull().default(0.8),
    expiresAt: text("expires_at"), // YYYY-MM-DD
    createdBy: text("created_by").$type<"agent" | "manager" | "seed">().notNull(),
    pinned: boolean("pinned").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("mem_worker_idx").on(t.workerId)],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    kind: text("kind")
      .$type<"weekly" | "cover" | "conversation" | "timetable" | "swap" | "checkin" | "copilot" | "negotiate" | "reminder">()
      .notNull(),
    title: text("title").notNull(),
    goal: text("goal"),
    status: text("status").$type<"running" | "waiting" | "done" | "failed">().notNull(),
    plan: jsonb("plan").$type<PlanStep[]>().notNull().default([]),
    summary: text("summary"),
    subjectId: text("subject_id"),
    metrics: jsonb("metrics").$type<Record<string, number>>().notNull().default({}),
    startedAt: ts("started_at").notNull(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("runs_org_idx").on(t.orgId, t.startedAt)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    runId: text("run_id"),
    kind: text("kind")
      .$type<
        | "plan"
        | "step"
        | "tool_call"
        | "tool_result"
        | "decision"
        | "message_sent"
        | "message_received"
        | "approval_requested"
        | "approval_decided"
        | "error"
        | "recovery"
        | "privacy_check"
        | "memory"
        | "llm"
      >()
      .notNull(),
    actor: text("actor").$type<"agent" | "manager" | "worker" | "system">().notNull(),
    title: text("title").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    latencyMs: integer("latency_ms"),
    tokens: integer("tokens"),
    manualMinutes: real("manual_minutes").notNull().default(0),
    createdAt: ts("created_at").notNull(),
    realCreatedAt: ts("real_created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_run_idx").on(t.runId), index("audit_org_idx").on(t.orgId, t.createdAt)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    runId: text("run_id"),
    kind: text("kind")
      .$type<"broadcast" | "publish_roster" | "overtime" | "incentive" | "transfer" | "escalation" | "swap" | "share_contact" | "announcement">()
      .notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    action: jsonb("action").$type<{ type: string; [k: string]: unknown }>().notNull(),
    options: jsonb("options").$type<{ id: string; label: string; detail: string; action: { type: string; [k: string]: unknown } }[]>(),
    risk: text("risk").$type<"low" | "medium" | "high">().notNull(),
    policyReason: text("policy_reason").notNull(),
    status: text("status").$type<"pending" | "approved" | "rejected" | "expired">().notNull(),
    chosenOptionId: text("chosen_option_id"),
    decidedBy: text("decided_by"),
    decidedAt: ts("decided_at"),
    channel: text("channel").$type<"dashboard" | "whatsapp">(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("approvals_org_idx").on(t.orgId, t.status)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    runAt: ts("run_at").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<"pending" | "running" | "done" | "failed" | "cancelled">().notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    dedupeKey: text("dedupe_key"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("jobs_due_idx").on(t.status, t.runAt), uniqueIndex("jobs_dedupe_idx").on(t.dedupeKey)],
);

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: text("org_id").notNull(),
    topic: text("topic").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("events_org_idx").on(t.orgId, t.id)],
);

export const simClock = pgTable("sim_clock", {
  orgId: text("org_id").primaryKey(),
  offsetMs: bigint("offset_ms", { mode: "number" }).notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type Org = typeof orgs.$inferSelect;
export type Outlet = typeof outlets.$inferSelect;
export type Worker = typeof workers.$inferSelect;
export type ShiftTemplate = typeof shiftTemplates.$inferSelect;
export type PlanningCycle = typeof planningCycles.$inferSelect;
export type Availability = typeof availability.$inferSelect;
export type RecurringConstraint = typeof recurringConstraints.$inferSelect;
export type Shift = typeof shifts.$inferSelect;
export type CoverRequest = typeof coverRequests.$inferSelect;
export type Offer = typeof offers.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Job = typeof jobs.$inferSelect;
