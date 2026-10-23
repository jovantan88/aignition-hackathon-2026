"use client";

import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";

/** Departure-board style characters that flip when they change */
export function SplitFlap({ text, className, tile = true }: { text: string; className?: string; tile?: boolean }) {
  return (
    <span className={cn("inline-flex gap-[2px] font-mono", className)} aria-label={text}>
      {text.split("").map((ch, i) =>
        ch === " " ? (
          <span key={i} className="w-[0.45em]" />
        ) : (
          <span
            key={i}
            className={cn(
              "relative inline-flex h-[1.5em] w-[0.82em] items-center justify-center overflow-hidden leading-none",
              tile && "rounded-[2px] bg-ink text-paper",
              tile && "after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-paper/15",
            )}
          >
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={ch}
                initial={{ rotateX: -90, opacity: 0 }}
                animate={{ rotateX: 0, opacity: 1 }}
                exit={{ rotateX: 90, opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.3, 0.7, 0.2, 1] }}
                className="inline-block"
              >
                {ch}
              </motion.span>
            </AnimatePresence>
          </span>
        ),
      )}
    </span>
  );
}
