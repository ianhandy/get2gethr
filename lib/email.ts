import { Resend } from "resend";
import { format } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import type { Event, ProposedSlot } from "./db/schema";

// Lazy init — avoids throwing at build time when env vars aren't set
let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const FROM = process.env.EMAIL_FROM ?? "Group Scheduler <noreply@example.com>";
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

function formatSlot(slot: ProposedSlot, timezone: string): string {
  const start = toZonedTime(new Date(slot.startTime * 1000), timezone);
  const end = toZonedTime(new Date(slot.endTime * 1000), timezone);
  return `${format(start, "EEEE, MMMM d, yyyy 'at' h:mm a")} – ${format(end, "h:mm a")} (${timezone})`;
}

export async function sendInviteEmail(
  to: string,
  event: Event,
  inviteToken: string
): Promise<void> {
  const inviteUrl = `${BASE_URL}/invite/${inviteToken}`;
  await getResend().emails.send({
    from: FROM,
    to,
    subject: `You're invited: ${event.title}`,
    html: `
      <h2>You're invited to schedule a meeting!</h2>
      <p><strong>${event.initiatorName}</strong> wants to find a time to meet for <strong>${event.title}</strong>.</p>
      ${event.description ? `<p>${event.description}</p>` : ""}
      <p>Click below to connect your Google Calendar and share your availability:</p>
      <a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#4F46E5;color:white;text-decoration:none;border-radius:6px;">View Invitation</a>
      <p style="color:#666;font-size:14px;margin-top:24px;">If you don't want to participate, you can decline at the link above.</p>
    `,
  });
}

export async function sendProposalEmail(
  to: string,
  event: Event,
  slot: ProposedSlot,
  confirmToken: string
): Promise<void> {
  const confirmUrl = `${BASE_URL}/invite/${confirmToken}/confirm`;
  const slotText = formatSlot(slot, event.timezone);
  await getResend().emails.send({
    from: FROM,
    to,
    subject: `Meeting time proposed: ${event.title}`,
    html: `
      <h2>A meeting time has been found!</h2>
      <p>Everyone is available at:</p>
      <p style="font-size:18px;font-weight:bold;padding:16px;background:#F0FDF4;border-radius:8px;">${slotText}</p>
      <p>Please confirm or decline this time:</p>
      <a href="${confirmUrl}" style="display:inline-block;padding:12px 24px;background:#4F46E5;color:white;text-decoration:none;border-radius:6px;">Confirm or Decline</a>
    `,
  });
}

export async function sendConfirmationEmail(
  to: string,
  event: Event,
  slot: ProposedSlot
): Promise<void> {
  const slotText = formatSlot(slot, event.timezone);
  await getResend().emails.send({
    from: FROM,
    to,
    subject: `Meeting confirmed: ${event.title}`,
    html: `
      <h2>Your meeting is confirmed!</h2>
      <p><strong>${event.title}</strong> is scheduled for:</p>
      <p style="font-size:18px;font-weight:bold;padding:16px;background:#F0FDF4;border-radius:8px;">${slotText}</p>
      <p>See you there!</p>
    `,
  });
}

export async function sendNoSlotsEmail(to: string, event: Event): Promise<void> {
  await getResend().emails.send({
    from: FROM,
    to,
    subject: `No common time found: ${event.title}`,
    html: `
      <h2>Unfortunately, no common time was found</h2>
      <p>We couldn't find a time that works for everyone for <strong>${event.title}</strong>.</p>
      <p>Please reach out to ${event.initiatorName} at ${event.initiatorEmail} to coordinate manually.</p>
    `,
  });
}
