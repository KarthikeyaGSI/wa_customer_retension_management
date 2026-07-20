// ============================================================
// Slot computation for appointment booking.
//
// Pure, unit-testable, no I/O. Given an account's weekly
// availability windows and its existing (non-cancelled)
// appointments, produce the free, bookable slot start-times for a
// date range. Timezones are handled by anchoring availability
// "minutes-from-midnight" to the configured IANA zone via the
// standard Intl offset trick — no external dependency.
// ============================================================

import type { AppointmentAvailability, Appointment } from '@/types';

export interface AvailabilityWindow {
  day_of_week: number;
  start_minutes: number;
  end_minutes: number;
  slot_minutes: number;
  timezone: string;
}

/** Milliseconds the given timezone is ahead of UTC at `date`. */
function tzOffsetMs(timeZone: string, date: Date): number {
  // Render `date` in the target zone, then interpret those wall-clock
  // parts as if they were UTC and measure the delta. (The well-known
  // Intl offset trick — no library needed.)
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0; // some engines emit "24" at midnight
  const asUtc = Date.UTC(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    hour,
    Number(get('minute')),
    Number(get('second')),
  );
  return asUtc - date.getTime();
}

/**
 * Convert "minutes from local midnight" on `day` (a UTC instant at
 * that local midnight anchor) into a concrete UTC instant, using the
 * timezone offset at that moment.
 */
function minutesToUtc(
  dayAnchorUtc: number,
  minutes: number,
  timeZone: string,
): number {
  const offset = tzOffsetMs(timeZone, new Date(dayAnchorUtc));
  // Local midnight in UTC = dayAnchorUtc - offset; add the minutes.
  return dayAnchorUtc - offset + minutes * 60_000;
}

export interface FreeSlot {
  start: string; // ISO UTC
  end: string; // ISO UTC
}

/**
 * @param windows  availability rows for the account
 * @param taken    existing appointments to avoid (any non-cancelled)
 * @param from     range start (ISO)
 * @param to       range end (ISO)
 * @param maxSlots cap to keep payloads small
 */
export function computeFreeSlots(
  windows: AvailabilityWindow[],
  taken: { scheduled_at: string; duration_minutes: number }[],
  from: string,
  to: string,
  maxSlots = 60,
): FreeSlot[] {
  if (!windows.length) return [];

  const byDay = new Map<number, AvailabilityWindow>();
  for (const w of windows) byDay.set(w.day_of_week, w);

  const takenRanges = taken.map((t) => ({
    start: new Date(t.scheduled_at).getTime(),
    end: new Date(t.scheduled_at).getTime() + t.duration_minutes * 60_000,
  }));

  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  const slots: FreeSlot[] = [];

  // Iterate day by day. Anchor each day at its UTC midnight.
  const dayMs = 86_400_000;
  const firstMidnight = Math.floor(fromMs / dayMs) * dayMs;

  for (let d = firstMidnight; d <= toMs && slots.length < maxSlots; d += dayMs) {
    const date = new Date(d);
    const dow = date.getUTCDay();
    const win = byDay.get(dow);
    if (!win) continue;

    const slotMs = win.slot_minutes * 60_000;
    let cursor = minutesToUtc(d, win.start_minutes, win.timezone);
    const dayEnd = minutesToUtc(d, win.end_minutes, win.timezone);

    while (cursor + slotMs <= dayEnd && slots.length < maxSlots) {
      const slotEnd = cursor + slotMs;
      if (slotEnd <= fromMs) {
        cursor += slotMs;
        continue;
      }
      const overlaps = takenRanges.some(
        (r) => cursor < r.end && slotEnd > r.start,
      );
      if (!overlaps) {
        slots.push({
          start: new Date(cursor).toISOString(),
          end: new Date(slotEnd).toISOString(),
        });
      }
      cursor += slotMs;
    }
  }

  return slots;
}

export type { AppointmentAvailability, Appointment };
