import { Capacitor, registerPlugin } from "@capacitor/core";

export type DeviceCalendarPlatform = "ios" | "android";

interface AccessResult {
  granted: boolean;
  status: string;
}

interface BusyIntervalsResult {
  intervals: [number, number][];
  calendarCount: number;
}

interface DeviceCalendarPlugin {
  requestFullAccess(): Promise<AccessResult>;
  busyIntervals(options: {
    startDate: string;
    endDate: string;
    timeZone: string;
  }): Promise<BusyIntervalsResult>;
}

const DeviceCalendar = registerPlugin<DeviceCalendarPlugin>("DeviceCalendar");

export function deviceCalendarPlatform(): DeviceCalendarPlatform | null {
  if (!Capacitor.isNativePlatform()) return null;
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android" ? platform : null;
}

export function subscribeDeviceCalendarPlatform(): () => void {
  return () => {};
}

export async function readDeviceBusyTimes(options: {
  startDate: string;
  endDate: string;
  timeZone: string;
}): Promise<BusyIntervalsResult> {
  const access = await DeviceCalendar.requestFullAccess();
  if (!access.granted) {
    throw new Error(
      access.status === "denied"
        ? "Calendar access is off. You can turn it on in Settings."
        : "Calendar access wasn't granted."
    );
  }
  return DeviceCalendar.busyIntervals(options);
}
