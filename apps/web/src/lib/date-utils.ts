/**
 * Date utilities for MCT LMS — IST ↔ UTC round-trip
 * Product: Admin enters IST (Asia/Kolkata) via datetime-local.
 * Storage: DB timestamptz (UTC ISO).
 * Display: Frontend converts UTC ISO → IST for user.
 * Conversion must happen exactly once each direction.
 */

export function localInputToUTCISOString(localInput: string): string | undefined {
  if (!localInput) return undefined;
  // localInput like "2026-09-17T01:02" is parsed as local time (IST in India)
  const d = new Date(localInput);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export function utcToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  // Use local getters — browser in IST will produce IST wall time
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${y}-${m}-${day}T${h}:${min}`;
}

export function formatIST(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  // Explicit Asia/Kolkata to avoid browser timezone variance
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatISTDateOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Compute end ISO from start ISO + duration minutes. Returns undefined if start missing. */
export function computeEndFromStartAndDuration(startUTCISO: string | undefined, durationMinutes: number | undefined): string | undefined {
  if (!startUTCISO || !durationMinutes) return undefined;
  const start = new Date(startUTCISO);
  if (isNaN(start.getTime())) return undefined;
  const end = new Date(start.getTime() + durationMinutes * 60000);
  return end.toISOString();
}
