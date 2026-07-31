import { DateTime } from "luxon";

function parseExplicitWindowEnd(value, timezone) {
  if (!value) return null;

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = dateOnly
    ? DateTime.fromISO(value, { zone: timezone }).set({ hour: 12 })
    : DateTime.fromISO(value, { setZone: true }).setZone(timezone);

  if (!parsed.isValid) {
    throw new Error(`Invalid window end: ${value}`);
  }
  if (parsed.weekday !== 7 || parsed.hour !== 12 || parsed.minute !== 0) {
    throw new Error("Window end must be a Sunday at 12:00 PM America/New_York.");
  }
  return parsed.startOf("minute");
}

export function calculateWeeklyWindow({
  now = new Date(),
  timezone = "America/New_York",
  explicitWindowEnd,
} = {}) {
  let end = parseExplicitWindowEnd(explicitWindowEnd, timezone);

  if (!end) {
    const localNow = DateTime.fromJSDate(now, { zone: timezone });
    const daysSinceSunday = localNow.weekday % 7;
    end = localNow
      .startOf("day")
      .minus({ days: daysSinceSunday })
      .set({ hour: 12 });

    if (localNow < end) {
      end = end.minus({ weeks: 1 });
    }
  }

  const start = end.minus({ weeks: 1 });
  return {
    timezone,
    start,
    end,
    periodStart: start.toISO({ suppressMilliseconds: true }),
    periodEnd: end.toISO({ suppressMilliseconds: true }),
    apiSince: start.toUTC().toISO({ suppressMilliseconds: true }),
    apiUntil: end.toUTC().toISO({ suppressMilliseconds: true }),
    date: end.toISODate(),
    slug: `building-in-public-${end.toISODate()}`,
  };
}
