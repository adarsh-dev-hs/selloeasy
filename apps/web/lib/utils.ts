import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', opts).format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined) {
  return formatDate(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [365 * 86400000, 'y'],
    [30 * 86400000, 'mo'],
    [7 * 86400000, 'w'],
    [86400000, 'd'],
    [3600000, 'h'],
    [60000, 'm'],
  ];
  for (const [ms, label] of units) {
    if (abs >= ms) {
      const n = Math.floor(abs / ms);
      return diff >= 0 ? `${n}${label} ago` : `in ${n}${label}`;
    }
  }
  return 'just now';
}

export function formatMoney(amount: number | null | undefined, currency = 'INR') {
  if (amount === null || amount === undefined) return '—';
  if (currency === 'INR') {
    // Indian convention: crores (1e7) and lakhs (1e5).
    if (amount >= 1e7) return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: amount >= 1e9 ? 0 : 1 }).format(amount / 1e7)} Cr`;
    if (amount >= 1e5) return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(amount / 1e5)} L`;
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: amount >= 1e6 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(amount);
}

export function formatNumber(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return new Intl.NumberFormat('en-IN').format(n);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function titleCase(s: string) {
  return s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
