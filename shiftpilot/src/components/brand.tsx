import { cn } from "@/lib/utils";

/** ShiftPilot mark: an ink tile with three roster lines and a signal dot */
export function BrandMark({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#1B1C1F" />
      <rect x="7" y="9" width="12" height="2.4" rx="1.2" fill="#FFFFFF" />
      <rect x="7" y="14.8" width="18" height="2.4" rx="1.2" fill="#FFFFFF" opacity="0.85" />
      <rect x="7" y="20.6" width="9" height="2.4" rx="1.2" fill="#FFFFFF" opacity="0.7" />
      <circle cx="23.5" cy="10.2" r="3" fill="#7C86E8" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrandMark size={22} />
      <span className="font-display text-[15px] font-semibold leading-none tracking-tight">ShiftPilot</span>
    </span>
  );
}
