import { logError } from "@/lib/errors";
import { handle, requireUser } from "@/lib/session";
import { busyBetween, calendarConnected } from "@/lib/google";
import { computeSlots, suggestSlots, withAvailabilityDefaults } from "@/lib/availability";

export const maxDuration = 30;

/** Open slots = weekly hours − Google Calendar busy time (all calendars) − manual blocks. */
export const GET = handle(async () => {
  const u = await requireUser();
  const a = withAvailabilityDefaults(u.availability);
  const now = new Date();
  const end = new Date(now.getTime() + (a.daysAhead + 1) * 86_400_000);
  let busy: { start: string; end: string }[] = [];
  let calendarError: string | null = null;
  const connected = calendarConnected(u);
  if (connected) {
    try {
      busy = await busyBetween(u, now, end);
    } catch (e) {
      logError("calendar", e);
      calendarError = "couldn't read your calendar";
    }
  }
  const slots = computeSlots(a, busy, now);
  return Response.json({
    connected,
    calendarError,
    timezone: a.timezone,
    meetingMinutes: a.meetingMinutes,
    slots,
    busy,
    suggested: suggestSlots(slots, a.timezone),
  });
});
