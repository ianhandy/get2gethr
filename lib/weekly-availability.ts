export const WEEKLY_SLOT_STATES = [
  "available",
  "preferred",
  "unavailable",
] as const;

export type WeeklySlotState = (typeof WEEKLY_SLOT_STATES)[number];

export const DAYS_PER_WEEK = 7;
export const HOUR_SLOTS_PER_DAY = 24;
export const WEEKLY_SLOT_COUNT = DAYS_PER_WEEK * HOUR_SLOTS_PER_DAY;
export const DEFAULT_DAY_START_HOUR = 6;
export const DEFAULT_DAY_END_HOUR = 22;

export function blankWeeklyAvailability(): WeeklySlotState[] {
  return Array.from({ length: WEEKLY_SLOT_COUNT }, (_, index) => {
    const hour = index % HOUR_SLOTS_PER_DAY;
    return hour >= DEFAULT_DAY_START_HOUR && hour < DEFAULT_DAY_END_HOUR
      ? "available"
      : "unavailable";
  });
}

/** Converts JavaScript's Sunday-first weekday to the planner's Monday-first index. */
export function mondayFirstDayIndex(sundayFirstWeekday: number): number {
  return (sundayFirstWeekday + 6) % 7;
}

export function weeklySlotIndex(dayIndex: number, hourIndex: number): number {
  return dayIndex * HOUR_SLOTS_PER_DAY + hourIndex;
}

export function isBlockedWeeklyState(state: WeeklySlotState): boolean {
  return state === "unavailable";
}

export function isWeeklyAvailability(value: unknown): value is WeeklySlotState[] {
  return (
    Array.isArray(value) &&
    value.length === WEEKLY_SLOT_COUNT &&
    value.every((state) =>
      (WEEKLY_SLOT_STATES as readonly unknown[]).includes(state)
    )
  );
}

export function parseWeeklyAvailability(raw: string | null): WeeklySlotState[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isWeeklyAvailability(parsed)) return parsed;

    // Local pre-release builds briefly stored 48 half-hour cells and separate
    // sleeping/working labels. Read them safely as unavailable so an event
    // created during that build does not become free overnight.
    if (Array.isArray(parsed) && parsed.length === DAYS_PER_WEEK * 48) {
      const hourly: WeeklySlotState[] = [];
      for (let hour = 0; hour < WEEKLY_SLOT_COUNT; hour += 1) {
        const first = parsed[hour * 2];
        const second = parsed[hour * 2 + 1];
        const blocked = [first, second].some(
          (state) =>
            state === "unavailable" || state === "sleeping" || state === "working"
        );
        hourly.push(
          blocked ? "unavailable" : first === "preferred" || second === "preferred"
            ? "preferred"
            : "available"
        );
      }
      return hourly;
    }
    return null;
  } catch {
    return null;
  }
}

export function hasOpenWeeklyRun(
  availability: WeeklySlotState[],
  durationMinutes: number
): boolean {
  const requiredSlots = Math.ceil(durationMinutes / 60);
  for (let day = 0; day < DAYS_PER_WEEK; day += 1) {
    let openRun = 0;
    for (let slot = 0; slot < HOUR_SLOTS_PER_DAY; slot += 1) {
      const state = availability[weeklySlotIndex(day, slot)];
      openRun = state && !isBlockedWeeklyState(state) ? openRun + 1 : 0;
      if (openRun >= requiredSlots) return true;
    }
  }
  return false;
}
