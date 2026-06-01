import { motion } from "@/lib/tokens";

/**
 * Motion language — convenience exports for JS-driven animations.
 * For CSS classes (Tailwind utilities), prefer the duration-* and ease-*
 * tokens defined in globals.css so SSR + CSR stay consistent.
 */

export const ms = motion.duration;
export const ease = motion.easing;

export const transitions = {
  micro: `all ${ms.micro}ms ${ease.micro}`,
  entry: `all ${ms.entry}ms ${ease.entry}`,
  exit: `all ${ms.exit}ms ${ease.exit}`,
  page: `all ${ms.page}ms ${ease.entry}`,
} as const;

export type Transition = keyof typeof transitions;
