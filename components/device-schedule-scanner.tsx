"use client";

import { FormEvent, useState } from "react";
import {
  scanScheduleOnDevice,
  type ScheduleBlock,
} from "@/lib/device-schedule";

interface EditableBlock extends ScheduleBlock {
  id: string;
}

interface Props {
  token: string;
  event: {
    startDate: string;
    endDate: string;
    timezone: string;
  };
  onSaved: () => Promise<void>;
  label?: string;
}

function editable(block: ScheduleBlock): EditableBlock {
  return { ...block, id: crypto.randomUUID() };
}

export function DeviceScheduleScanner({
  token,
  event,
  onSaved,
  label = "scan a paper schedule",
}: Props) {
  const [blocks, setBlocks] = useState<EditableBlock[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [usedAppleIntelligence, setUsedAppleIntelligence] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      const result = await scanScheduleOnDevice({
        startDate: event.startDate,
        endDate: event.endDate,
        timeZone: event.timezone,
      });
      if (result.cancelled) return;
      setBlocks(result.blocks.map(editable));
      setUsedAppleIntelligence(result.usedAppleIntelligence);
    } catch (scanError) {
      setError(
        scanError instanceof Error ? scanError.message : "we couldn't read that schedule."
      );
    } finally {
      setScanning(false);
    }
  }

  function addBlock() {
    setBlocks((current) => [
      ...(current ?? []),
      editable({ date: event.startDate, startTime: "09:00", endTime: "10:00" }),
    ]);
  }

  function updateBlock(id: string, patch: Partial<ScheduleBlock>) {
    setBlocks((current) =>
      current?.map((block) => (block.id === id ? { ...block, ...patch } : block)) ?? null
    );
  }

  async function save(submission: FormEvent) {
    submission.preventDefault();
    const values = blocks ?? [];
    if (values.some((block) => block.endTime <= block.startTime)) {
      setError("each busy time must end after it starts.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/invite/${token}/manual-schedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          blocks: values.map(({ date, startTime, endTime }) => ({
            date,
            startTime,
            endTime,
          })),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "we couldn't save those times.");
      setBlocks(null);
      await onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "we couldn't save those times."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={scan}
        disabled={scanning}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border px-5 text-sm font-semibold disabled:opacity-50"
        style={{
          borderColor: "var(--color-border)",
          background: "var(--color-bg)",
          color: "var(--color-primary)",
        }}
      >
        {scanning ? "reading schedule…" : label}
      </button>

      {error && !blocks && (
        <p role="alert" className="mt-3 text-sm" style={{ color: "var(--color-danger)" }}>
          {error}
        </p>
      )}

      {blocks && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto p-4"
          style={{ background: "color-mix(in srgb, var(--color-primary) 34%, transparent)" }}
        >
          <form
            onSubmit={save}
            className="ios-card mx-auto mt-[max(4vh,env(safe-area-inset-top))] max-w-lg rounded-2xl border p-5 shadow-xl"
            style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-bold" style={{ color: "var(--color-primary)" }}>
                  check the busy times
                </h2>
                <p className="mt-1 text-sm" style={{ color: "var(--color-muted)" }}>
                  {usedAppleIntelligence
                    ? "your iphone found these. fix anything it got wrong."
                    : "your iphone read the image but needs your help turning it into times."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setBlocks(null)}
                className="min-h-11 min-w-11 rounded-lg text-xl"
                aria-label="close"
                style={{ color: "var(--color-muted)" }}
              >
                ×
              </button>
            </div>

            <div className="space-y-3">
              {blocks.map((block) => (
                <fieldset
                  key={block.id}
                  className="rounded-xl border p-3"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <legend className="px-1 text-sm font-semibold">busy time</legend>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <input
                      aria-label="date"
                      type="date"
                      min={event.startDate}
                      max={event.endDate}
                      required
                      value={block.date}
                      onChange={(change) => updateBlock(block.id, { date: change.target.value })}
                      className="min-h-11 rounded-lg border px-3"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                    />
                    <input
                      aria-label="starts"
                      type="time"
                      required
                      value={block.startTime}
                      onChange={(change) => updateBlock(block.id, { startTime: change.target.value })}
                      className="min-h-11 rounded-lg border px-3"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                    />
                    <input
                      aria-label="ends"
                      type="time"
                      required
                      value={block.endTime}
                      onChange={(change) => updateBlock(block.id, { endTime: change.target.value })}
                      className="min-h-11 rounded-lg border px-3"
                      style={{ borderColor: "var(--color-border)", background: "var(--color-bg)" }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setBlocks((current) => current?.filter((item) => item.id !== block.id) ?? null)}
                    className="mt-2 min-h-11 text-sm"
                    style={{ color: "var(--color-danger)" }}
                  >
                    remove
                  </button>
                </fieldset>
              ))}
            </div>

            <button
              type="button"
              onClick={addBlock}
              className="mt-3 min-h-11 text-sm font-semibold"
              style={{ color: "var(--color-accent-a)" }}
            >
              + add busy time
            </button>

            {error && (
              <p role="alert" className="mt-3 text-sm" style={{ color: "var(--color-danger)" }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="mt-5 min-h-[52px] w-full rounded-xl px-6 font-semibold disabled:opacity-50"
              style={{ background: "var(--color-accent-a)", color: "var(--color-on-accent)" }}
            >
              {saving
                ? "saving…"
                : blocks.length === 0
                  ? "confirm no busy time"
                  : "use these busy times"}
            </button>
            <p className="mt-3 text-center text-xs" style={{ color: "var(--color-muted)" }}>
              the image and recognized text stay on this iphone.
            </p>
          </form>
        </div>
      )}
    </>
  );
}
