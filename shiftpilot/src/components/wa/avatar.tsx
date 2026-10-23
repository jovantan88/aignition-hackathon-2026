import { BrandMark } from "@/components/brand";
import { cn } from "@/lib/utils";

export function initials(name: string) {
  const parts = name.replace(/\(.*?\)/g, "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function PersonAvatar({ name, hue = 20, size = 40, className }: { name: string; hue?: number; size?: number; className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white select-none", className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `oklch(0.62 0.09 ${hue})`,
      }}
    >
      {initials(name)}
    </span>
  );
}

export function BusinessAvatar({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-[#16130F]", className)} style={{ width: size, height: size }}>
      <BrandMark size={size * 0.62} />
    </span>
  );
}

export function GroupAvatar({ label, size = 40 }: { label: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#DFE5E7] font-mono text-[#54656F]"
      style={{ width: size, height: size, fontSize: size * 0.3 }}
    >
      {label}
    </span>
  );
}

/** WhatsApp's green verified business badge */
export function VerifiedBadge({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Verified business" className="shrink-0">
      <path
        fill="#1DAA61"
        d="M12 1.5l2.4 1.8 3-.2 1 2.8 2.6 1.6-.6 2.9 1.4 2.6-2 2.2-.2 3-2.9.7-1.6 2.5-2.8-1L12 22.5l-2.3-1.8-3 .2-1-2.8-2.6-1.6.6-2.9L2.3 11l2-2.2.2-3 2.9-.7L9 2.6l2.8 1z"
      />
      <path fill="#fff" d="M10.6 15.6l-3.2-3.2 1.3-1.3 1.9 1.9 4.7-4.7 1.3 1.3z" />
    </svg>
  );
}
