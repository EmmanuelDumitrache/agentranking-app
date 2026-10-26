import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
/** Strips null bytes (0x00) that PostgreSQL UTF8 rejects with "invalid byte sequence" */
export function sanitizeForPostgres(s: string): string {
  return s.replace(/\0/g, "");
}
export function truncateAddress(address: string, chars = 4): string {
  if (!address) return "";
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}
export function timeAgo(date: Date | string): string {
  const now = new Date();
  const then = new Date(date);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d`;
  if (seconds < 31536000) return `${Math.floor(seconds / 2592000)}mo`;
  return `${Math.floor(seconds / 31536000)}y`;
}
export function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-400";
  if (score >= 60) return "text-yellow-400";
  if (score >= 40) return "text-orange-400";
  return "text-red-400";
}
/** Format global organic rank; 0 or null means unranked. */
export function displayRank(rank: number | null | undefined): string {
  if (!rank || rank <= 0) return "Unranked";
  return `#${Math.round(rank).toLocaleString("en-US")}`;
}
/** Organic rank label for product UI (Final Rank cohort). */
export function displayOrganicRank(rank: number | null | undefined): string {
  const label = displayRank(rank);
  return label === "Unranked" ? label : label;
}
/** Middle-truncate a URL/string: first N chars + … + last M chars */
export function truncateMiddle(str: string, startChars = 15, endChars = 6): string {
  if (str.length <= startChars + endChars + 3) return str;
  return `${str.slice(0, startChars)}…${str.slice(-endChars)}`;
}