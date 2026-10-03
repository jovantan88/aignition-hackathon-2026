"use client";

import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

type TeamRow = { id: number };

const inputClass =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function TeamMembersFields({ skills, requireFirstRow }: { skills: string[]; requireFirstRow: boolean }) {
  const [rows, setRows] = useState<TeamRow[]>([{ id: 0 }]);
  const nextId = useRef(1);
  const skillsPlaceholder = skills.length ? skills.slice(0, 2).join(", ") : "barista, cashier";

  const addRow = () => {
    setRows((current) => [...current, { id: nextId.current++ }]);
  };

  const removeRow = (id: number) => {
    setRows((current) => current.filter((row) => row.id !== id));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)_2.75rem] gap-3 px-1 text-sm font-medium text-muted-foreground md:grid">
        <span>Name</span>
        <span>Country code + number</span>
        <span>Skills</span>
        <span className="sr-only">Actions</span>
      </div>

      {rows.map((row, index) => (
        <div
          key={row.id}
          className="grid gap-3 rounded-xl border bg-background p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)_2.75rem] md:items-center md:border-0 md:p-0"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-muted-foreground md:sr-only">Name</span>
            <input
              name="teamName"
              autoFocus={index === 0}
              required={index === 0 && requireFirstRow}
              autoComplete="name"
              placeholder="Aisha"
              aria-label={`Person ${index + 1} name`}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-muted-foreground md:sr-only">Country code + number</span>
            <input
              name="teamPhone"
              type="tel"
              inputMode="tel"
              required={index === 0 && requireFirstRow}
              autoComplete="tel"
              placeholder="+65 9123 4567"
              aria-label={`Person ${index + 1} country code and phone number`}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-muted-foreground md:sr-only">Skills</span>
            <input
              name="teamSkills"
              placeholder={skillsPlaceholder}
              aria-label={`Person ${index + 1} skills`}
              className={inputClass}
            />
          </label>

          <button
            type="button"
            onClick={() => removeRow(row.id)}
            disabled={rows.length === 1}
            aria-label={`Remove person ${index + 1}`}
            title="Remove person"
            className="inline-flex size-11 items-center justify-center justify-self-end rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:invisible"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addRow}
        className="inline-flex h-10 items-center gap-2 self-start rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Plus className="size-4" aria-hidden="true" />
        Add another person
      </button>
    </div>
  );
}
