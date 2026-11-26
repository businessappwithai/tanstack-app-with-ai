/**
 * The one helper the editors take from their host: merge Tailwind class names.
 * Kept here so the package imports nothing from the application around it.
 */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
