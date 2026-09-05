import { Capacitor, registerPlugin } from "@capacitor/core";

export interface ScheduleBlock {
  date: string;
  startTime: string;
  endTime: string;
}

interface ScanResult {
  cancelled?: boolean;
  blocks: ScheduleBlock[];
  usedAppleIntelligence: boolean;
}

interface DeviceSchedulePlugin {
  scan(options: {
    startDate: string;
    endDate: string;
    timeZone: string;
  }): Promise<ScanResult>;
}

const DeviceSchedule = registerPlugin<DeviceSchedulePlugin>("DeviceSchedule");

export function canScanScheduleOnDevice(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
}

export function scanScheduleOnDevice(options: {
  startDate: string;
  endDate: string;
  timeZone: string;
}): Promise<ScanResult> {
  return DeviceSchedule.scan(options);
}
