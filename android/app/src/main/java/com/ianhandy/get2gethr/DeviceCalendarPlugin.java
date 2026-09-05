package com.ianhandy.get2gethr;

import android.Manifest;
import android.database.Cursor;
import android.provider.CalendarContract;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;

@CapacitorPlugin(
    name = "DeviceCalendar",
    permissions = @Permission(alias = "calendar", strings = Manifest.permission.READ_CALENDAR)
)
public class DeviceCalendarPlugin extends Plugin {
    private static final String[] PROJECTION = new String[] {
        CalendarContract.Instances.BEGIN,
        CalendarContract.Instances.END,
        CalendarContract.Instances.CALENDAR_ID,
        CalendarContract.Instances.AVAILABILITY,
        CalendarContract.Instances.STATUS,
    };

    @PluginMethod
    public void requestFullAccess(PluginCall call) {
        if (getPermissionState("calendar") == PermissionState.GRANTED) {
            resolveAccess(call, true);
            return;
        }
        requestPermissionForAlias("calendar", call, "calendarPermissionCallback");
    }

    @PermissionCallback
    private void calendarPermissionCallback(PluginCall call) {
        resolveAccess(call, getPermissionState("calendar") == PermissionState.GRANTED);
    }

    @PluginMethod
    public void busyIntervals(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            call.reject("Calendar access is not enabled.", "calendar_denied");
            return;
        }
        String startDate = call.getString("startDate");
        String endDate = call.getString("endDate");
        String timeZoneName = call.getString("timeZone");
        long[] window = parseWindow(startDate, endDate, timeZoneName);
        if (window == null) {
            call.reject("The calendar window is invalid.", "invalid_window");
            return;
        }

        List<long[]> intervals = new ArrayList<>();
        Set<Long> calendarIds = new HashSet<>();
        try (Cursor cursor = CalendarContract.Instances.query(
            getContext().getContentResolver(),
            PROJECTION,
            window[0],
            window[1]
        )) {
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    int availability = cursor.getInt(3);
                    int status = cursor.getInt(4);
                    if (availability == CalendarContract.Events.AVAILABILITY_FREE ||
                        status == CalendarContract.Events.STATUS_CANCELED) {
                        continue;
                    }
                    long start = Math.max(cursor.getLong(0), window[0]);
                    long end = Math.min(cursor.getLong(1), window[1]);
                    if (end > start) {
                        intervals.add(new long[] { start, end });
                        calendarIds.add(cursor.getLong(2));
                    }
                }
            }
        } catch (SecurityException error) {
            call.reject("Calendar access is not enabled.", "calendar_denied", error);
            return;
        }

        intervals.sort((left, right) -> Long.compare(left[0], right[0]));
        List<long[]> merged = new ArrayList<>();
        for (long[] interval : intervals) {
            if (!merged.isEmpty() && interval[0] <= merged.get(merged.size() - 1)[1]) {
                long[] last = merged.get(merged.size() - 1);
                last[1] = Math.max(last[1], interval[1]);
            } else {
                merged.add(interval.clone());
            }
        }

        JSArray values = new JSArray();
        for (long[] interval : merged) {
            values.put(new JSArray(Arrays.asList(interval[0], interval[1])));
        }
        JSObject result = new JSObject();
        result.put("intervals", values);
        result.put("calendarCount", calendarIds.size());
        call.resolve(result);
    }

    private void resolveAccess(PluginCall call, boolean granted) {
        JSObject result = new JSObject();
        result.put("granted", granted);
        result.put("status", granted ? "full_access" : "denied");
        call.resolve(result);
    }

    private static long[] parseWindow(String startDate, String endDate, String timeZoneName) {
        if (startDate == null || endDate == null || timeZoneName == null) return null;
        TimeZone timeZone = TimeZone.getTimeZone(timeZoneName);
        if ("GMT".equals(timeZone.getID()) && !"GMT".equals(timeZoneName)) return null;
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        formatter.setLenient(false);
        formatter.setTimeZone(timeZone);
        try {
            long start = formatter.parse(startDate).getTime();
            java.util.Calendar calendar = java.util.Calendar.getInstance(timeZone, Locale.US);
            calendar.setTime(formatter.parse(endDate));
            calendar.add(java.util.Calendar.DAY_OF_MONTH, 1);
            long end = calendar.getTimeInMillis();
            return end > start ? new long[] { start, end } : null;
        } catch (ParseException error) {
            return null;
        }
    }
}
