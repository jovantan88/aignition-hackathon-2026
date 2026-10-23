/**
 * WhatsApp Flows, defined in a subset of Flow JSON. The flow message carries
 * dynamic data (dates, outlets, coworkers) in flow_action_payload.data; the
 * simulator renders these screens as a full-screen sheet, like the real app.
 */
import { DOW_SHORT, dowOf, fmtShortDate } from "@/lib/time";

export type FlowOption = { id: string; title: string; description?: string };

export type FlowComponent =
  | { type: "TextHeading"; text: string }
  | { type: "TextBody"; text: string }
  | { type: "TextCaption"; text: string }
  | { type: "ChipsSelector"; name: string; label: string; options: FlowOption[]; maxSelected?: number }
  | { type: "CheckboxGroup"; name: string; label: string; options: FlowOption[] }
  | { type: "RadioButtonsGroup"; name: string; label: string; options: FlowOption[]; required?: boolean }
  | { type: "Dropdown"; name: string; label: string; options: FlowOption[]; required?: boolean }
  | { type: "DatePicker"; name: string; label: string; minDate?: string; maxDate?: string; required?: boolean }
  | { type: "TextArea"; name: string; label: string; helper?: string }
  | { type: "TextInput"; name: string; label: string; helper?: string }
  | { type: "PhotoPicker"; name: string; label: string; description?: string };

export type FlowScreen = {
  id: string;
  title: string;
  components: FlowComponent[];
  footer: { label: string; next?: string };
};

export type FlowDef = { id: string; name: string; screens: FlowScreen[] };

const SLOT_OPTIONS: FlowOption[] = [
  { id: "morning", title: "Morning" },
  { id: "afternoon", title: "Afternoon" },
  { id: "evening", title: "Evening" },
];

export type AvailabilityFlowData = {
  weekLabel: string;
  dates: string[];
  outlets: FlowOption[];
};

export function availabilityFlow(data: AvailabilityFlowData): FlowDef {
  return {
    id: "flow_availability",
    name: "Weekly availability",
    screens: [
      {
        id: "DAYS",
        title: `Availability · ${data.weekLabel}`,
        components: [
          { type: "TextBody", text: "Pick the times you can work. Leave a day empty if you can't." },
          { type: "TextCaption", text: "Morning 7am–12pm · Afternoon 12–5pm · Evening 5–11pm" },
          ...data.dates.map(
            (d): FlowComponent => ({
              type: "ChipsSelector",
              name: `day_${d}`,
              label: `${DOW_SHORT[dowOf(d)]} ${fmtShortDate(d)}`,
              options: SLOT_OPTIONS,
            }),
          ),
        ],
        footer: { label: "Next", next: "DETAILS" },
      },
      {
        id: "DETAILS",
        title: "A few details",
        components: [
          {
            type: "Dropdown",
            name: "max_hours",
            label: "Max hours this week",
            options: ["8", "12", "16", "20", "24", "30"].map((h) => ({ id: h, title: `${h} hours` })),
          },
          { type: "CheckboxGroup", name: "outlets", label: "Outlets you can work at", options: data.outlets },
          { type: "TextArea", name: "notes", label: "Anything else? (optional)", helper: "e.g. need to leave by 9pm on Friday" },
        ],
        footer: { label: "Submit" },
      },
    ],
  };
}

export type LeaveFlowData = { today: string; shifts: FlowOption[] };

export function leaveFlow(data: LeaveFlowData): FlowDef {
  return {
    id: "flow_leave",
    name: "Report absence",
    screens: [
      {
        id: "LEAVE",
        title: "Report absence",
        components: [
          { type: "RadioButtonsGroup", name: "shift", label: "Which shift?", options: data.shifts, required: true },
          {
            type: "Dropdown",
            name: "reason",
            label: "Reason",
            options: [
              { id: "sick", title: "Sick / MC" },
              { id: "emergency", title: "Family emergency" },
              { id: "school", title: "School / exam" },
              { id: "other", title: "Something else" },
            ],
            required: true,
          },
          { type: "PhotoPicker", name: "mc_photo", label: "MC photo (optional)", description: "Only the manager can see this." },
          { type: "TextArea", name: "notes", label: "Anything we should know?" },
        ],
        footer: { label: "Send" },
      },
    ],
  };
}

export type PreferencesFlowData = { coworkers: FlowOption[]; outlets: FlowOption[] };

export function preferencesFlow(data: PreferencesFlowData): FlowDef {
  return {
    id: "flow_preferences",
    name: "My preferences",
    screens: [
      {
        id: "PREFS",
        title: "Your preferences",
        components: [
          { type: "TextBody", text: "Helps ShiftPilot plan shifts you'll enjoy. You can change this anytime." },
          { type: "ChipsSelector", name: "times", label: "Favourite times", options: SLOT_OPTIONS },
          { type: "CheckboxGroup", name: "outlets", label: "Preferred outlets", options: data.outlets },
          { type: "CheckboxGroup", name: "coworkers", label: "Love working with", options: data.coworkers.slice(0, 12) },
          { type: "TextArea", name: "notes", label: "Anything else?" },
        ],
        footer: { label: "Save" },
      },
    ],
  };
}

export function flowDefFor(flowId: string, data: Record<string, unknown>): FlowDef | null {
  if (flowId === "flow_availability") return availabilityFlow(data as AvailabilityFlowData);
  if (flowId === "flow_leave") return leaveFlow(data as LeaveFlowData);
  if (flowId === "flow_preferences") return preferencesFlow(data as PreferencesFlowData);
  return null;
}
