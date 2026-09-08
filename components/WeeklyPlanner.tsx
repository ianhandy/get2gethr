"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  DEFAULT_DAY_END_HOUR,
  DEFAULT_DAY_START_HOUR,
  HOUR_SLOTS_PER_DAY,
  WEEKLY_SLOT_STATES,
  blankWeeklyAvailability,
  weeklySlotIndex,
  type WeeklySlotState,
} from "@/lib/weekly-availability";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const STATE_LABELS: Record<WeeklySlotState, string> = {
  available: "Available",
  preferred: "Preferred",
  unavailable: "Unavailable",
};

interface DayWindow {
  start: number;
  end: number;
}

type BoundaryEdge = "start" | "end";

function defaultDayWindows(): DayWindow[] {
  return DAYS.map(() => ({
    start: DEFAULT_DAY_START_HOUR,
    end: DEFAULT_DAY_END_HOUR,
  }));
}

function timeLabel(hour: number): string {
  if (hour === 24) return "12 AM";
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 || 12} ${suffix}`;
}

interface WeeklyPlannerProps {
  value: WeeklySlotState[];
  onChange: Dispatch<SetStateAction<WeeklySlotState[]>>;
  error?: string;
}

export default function WeeklyPlanner({ value, onChange, error }: WeeklyPlannerProps) {
  const [brush, setBrush] = useState<WeeklySlotState>("unavailable");
  const [dayWindows, setDayWindows] = useState<DayWindow[]>(defaultDayWindows);
  const dayWindowsRef = useRef(dayWindows);
  const activePointer = useRef<number | null>(null);
  const lastPainted = useRef<number | null>(null);
  const activeBoundary = useRef<{
    dayIndex: number;
    edge: BoundaryEdge;
    pointerId: number;
  } | null>(null);

  function isInsideDayWindow(index: number): boolean {
    const day = Math.floor(index / HOUR_SLOTS_PER_DAY);
    const hour = index % HOUR_SLOTS_PER_DAY;
    const window = dayWindows[day];
    return Boolean(window && hour >= window.start && hour < window.end);
  }

  function paintSlot(index: number) {
    if (index === lastPainted.current || !isInsideDayWindow(index)) return;
    lastPainted.current = index;
    onChange((current) => {
      if (current[index] === brush) return current;
      const next = [...current];
      next[index] = brush;
      return next;
    });
  }

  function paintDay(dayIndex: number) {
    const window = dayWindows[dayIndex];
    if (!window) return;
    onChange((current) => {
      const next = [...current];
      for (let hour = window.start; hour < window.end; hour += 1) {
        next[weeklySlotIndex(dayIndex, hour)] = brush;
      }
      return next;
    });
  }

  function paintTimeAcrossWeek(hour: number) {
    onChange((current) => {
      const next = [...current];
      for (let day = 0; day < DAYS.length; day += 1) {
        const window = dayWindows[day];
        if (window && hour >= window.start && hour < window.end) {
          next[weeklySlotIndex(day, hour)] = brush;
        }
      }
      return next;
    });
  }

  function updateDayWindow(dayIndex: number, start: number, end: number) {
    const previous = dayWindowsRef.current[dayIndex];
    if (!previous) return;

    const nextStart = Math.max(0, Math.min(start, end - 1));
    const nextEnd = Math.min(24, Math.max(end, nextStart + 1));
    const nextWindows = dayWindowsRef.current.map((window, index) =>
      index === dayIndex ? { start: nextStart, end: nextEnd } : window
    );
    dayWindowsRef.current = nextWindows;
    setDayWindows(nextWindows);

    onChange((current) => {
      const next = [...current];
      for (let hour = 0; hour < HOUR_SLOTS_PER_DAY; hour += 1) {
        const index = weeklySlotIndex(dayIndex, hour);
        const outsideNext = hour < nextStart || hour >= nextEnd;
        const outsidePrevious = hour < previous.start || hour >= previous.end;
        if (outsideNext) next[index] = "unavailable";
        else if (outsidePrevious) next[index] = "available";
      }
      return next;
    });
  }

  function resetWeek() {
    const defaults = defaultDayWindows();
    dayWindowsRef.current = defaults;
    setDayWindows(defaults);
    onChange(blankWeeklyAvailability());
  }

  function moveBoundaryFromPointer(
    event: React.PointerEvent<HTMLButtonElement>,
    dayIndex: number,
    edge: BoundaryEdge
  ) {
    const track = event.currentTarget.parentElement;
    const window = dayWindowsRef.current[dayIndex];
    if (!track || !window) return;
    const rect = track.getBoundingClientRect();
    const rawHour = Math.round(((event.clientX - rect.left) / rect.width) * 24);
    if (edge === "start") updateDayWindow(dayIndex, rawHour, window.end);
    else updateDayWindow(dayIndex, window.start, rawHour);
  }

  function nudgeBoundary(dayIndex: number, edge: BoundaryEdge, delta: number) {
    const window = dayWindowsRef.current[dayIndex];
    if (!window) return;
    if (edge === "start") updateDayWindow(dayIndex, window.start + delta, window.end);
    else updateDayWindow(dayIndex, window.start, window.end + delta);
  }

  function slotFromPoint(clientX: number, clientY: number): number | null {
    const element = document.elementFromPoint(clientX, clientY);
    const button = element?.closest<HTMLButtonElement>("[data-weekly-slot]");
    if (!button) return null;
    const index = Number(button.dataset.weeklySlot);
    return Number.isInteger(index) ? index : null;
  }

  return (
    <div className="weekly-planner">
      <div className="day-window-list" aria-label="Daily hour boundaries">
        {DAYS.map((day, dayIndex) => {
          const window = dayWindows[dayIndex];
          const startPercent = (window.start / 24) * 100;
          const endPercent = (window.end / 24) * 100;
          return (
            <div className="day-window-row" key={day}>
              <span className="day-window-day">{day}</span>
              <div className="day-window-track">
                <span
                  className="day-window-fill"
                  style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }}
                  aria-hidden="true"
                />
                {(["start", "end"] as const).map((edge) => {
                  const hour = edge === "start" ? window.start : window.end;
                  return (
                    <button
                      key={edge}
                      type="button"
                      role="slider"
                      className={`day-window-handle day-window-handle-${edge}`}
                      style={{ left: `${(hour / 24) * 100}%` }}
                      aria-label={`${day} ${edge === "start" ? "starts" : "ends"}`}
                      aria-valuemin={edge === "start" ? 0 : window.start + 1}
                      aria-valuemax={edge === "start" ? window.end - 1 : 24}
                      aria-valuenow={hour}
                      aria-valuetext={timeLabel(hour)}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        activeBoundary.current = {
                          dayIndex,
                          edge,
                          pointerId: event.pointerId,
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        if (activeBoundary.current?.pointerId !== event.pointerId) return;
                        moveBoundaryFromPointer(event, dayIndex, edge);
                      }}
                      onPointerUp={(event) => {
                        if (activeBoundary.current?.pointerId !== event.pointerId) return;
                        activeBoundary.current = null;
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }}
                      onPointerCancel={() => {
                        activeBoundary.current = null;
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                          event.preventDefault();
                          nudgeBoundary(dayIndex, edge, -1);
                        }
                        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                          event.preventDefault();
                          nudgeBoundary(dayIndex, edge, 1);
                        }
                      }}
                    />
                  );
                })}
              </div>
              <span className="day-window-value">
                {timeLabel(window.start)} to {timeLabel(window.end)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="weekly-tools" role="toolbar" aria-label="Planner brush">
        {WEEKLY_SLOT_STATES.map((state) => (
          <button
            key={state}
            type="button"
            className={`weekly-tool weekly-tool-${state}`}
            aria-pressed={brush === state}
            onClick={() => setBrush(state)}
          >
            <span className="weekly-swatch" aria-hidden="true" />
            {STATE_LABELS[state]}
          </button>
        ))}
        <button type="button" className="weekly-reset" onClick={resetWeek}>
          Reset week
        </button>
      </div>

      <div
        className="weekly-grid"
        aria-label="Weekly availability planner"
        onPointerDown={(event) => {
          const target = event.target as HTMLElement;
          const button = target.closest<HTMLButtonElement>("[data-weekly-slot]");
          if (!button || button.disabled) return;
          event.preventDefault();
          activePointer.current = event.pointerId;
          lastPainted.current = null;
          event.currentTarget.setPointerCapture(event.pointerId);
          paintSlot(Number(button.dataset.weeklySlot));
        }}
        onPointerMove={(event) => {
          if (activePointer.current !== event.pointerId) return;
          const index = slotFromPoint(event.clientX, event.clientY);
          if (index !== null) paintSlot(index);
        }}
        onPointerUp={(event) => {
          if (activePointer.current !== event.pointerId) return;
          activePointer.current = null;
          lastPainted.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          activePointer.current = null;
          lastPainted.current = null;
        }}
      >
        <span className="weekly-grid-corner" aria-hidden="true" />
        {DAYS.map((day, dayIndex) => (
          <button
            key={day}
            type="button"
            className="weekly-day"
            onClick={() => paintDay(dayIndex)}
            aria-label={`Paint ${day} ${STATE_LABELS[brush].toLowerCase()}`}
          >
            {day}
          </button>
        ))}

        {Array.from({ length: HOUR_SLOTS_PER_DAY }, (_, hour) => (
          <div className="weekly-row" key={hour}>
            <button
              type="button"
              className="weekly-time"
              onClick={() => paintTimeAcrossWeek(hour)}
              aria-label={`Paint ${timeLabel(hour)} across every day ${STATE_LABELS[
                brush
              ].toLowerCase()}`}
            >
              {timeLabel(hour)}
            </button>
            {DAYS.map((day, dayIndex) => {
              const index = weeklySlotIndex(dayIndex, hour);
              const insideWindow =
                hour >= dayWindows[dayIndex].start && hour < dayWindows[dayIndex].end;
              const state = insideWindow ? value[index] ?? "available" : "unavailable";
              return (
                <button
                  key={day}
                  type="button"
                  data-weekly-slot={index}
                  disabled={!insideWindow}
                  className={`weekly-slot weekly-slot-${state}`}
                  aria-label={`${day}, ${timeLabel(hour)}, ${STATE_LABELS[state]}`}
                  onClick={() => paintSlot(index)}
                />
              );
            })}
          </div>
        ))}
      </div>
      {error ? <p className="ios-field-error">{error}</p> : null}
    </div>
  );
}
