import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emailDeliveries } from "@/lib/db/schema";
import {
  isAllowedSnsUrl,
  type SnsEnvelope,
  verifySnsEnvelope,
} from "@/lib/sns";

export const runtime = "nodejs";

interface SesEvent {
  eventType?: string;
  notificationType?: string;
  mail?: { messageId?: string };
  bounce?: { bounceType?: string; bounceSubType?: string };
  complaint?: { complaintFeedbackType?: string };
}

export async function processSesEvent(event: SesEvent): Promise<void> {
  const messageId = event.mail?.messageId;
  if (!messageId) return;

  const type = (event.eventType ?? event.notificationType ?? "").toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  if (type === "bounce" || type === "complaint") {
    const detail =
      type === "bounce"
        ? [event.bounce?.bounceType, event.bounce?.bounceSubType]
            .filter(Boolean)
            .join("/")
        : event.complaint?.complaintFeedbackType;
    await db
      .update(emailDeliveries)
      .set({
        status: "failed",
        error: `${type}${detail ? `: ${detail}` : ""}`.slice(0, 500),
        updatedAt: now,
      })
      .where(eq(emailDeliveries.providerMessageId, messageId));
  } else if (type === "delivery") {
    await db
      .update(emailDeliveries)
      .set({ status: "sent", error: null, updatedAt: now })
      .where(eq(emailDeliveries.providerMessageId, messageId));
  }
}

export async function POST(request: Request) {
  let envelope: SnsEnvelope;
  try {
    envelope = JSON.parse(await request.text()) as SnsEnvelope;
  } catch {
    return NextResponse.json({ error: "Invalid SNS message" }, { status: 400 });
  }

  const expectedTopic = process.env.AWS_SNS_TOPIC_ARN;
  if (!expectedTopic || envelope.TopicArn !== expectedTopic) {
    return NextResponse.json({ error: "Unexpected SNS topic" }, { status: 401 });
  }

  if (!(await verifySnsEnvelope(envelope))) {
    return NextResponse.json({ error: "Invalid SNS signature" }, { status: 401 });
  }

  if (envelope.Type === "SubscriptionConfirmation") {
    if (!envelope.SubscribeURL || !isAllowedSnsUrl(envelope.SubscribeURL)) {
      return NextResponse.json({ error: "Invalid subscription URL" }, { status: 400 });
    }
    const confirmation = await fetch(envelope.SubscribeURL, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!confirmation.ok) {
      return NextResponse.json({ error: "Subscription confirmation failed" }, { status: 502 });
    }
    return new NextResponse(null, { status: 204 });
  }

  if (envelope.Type === "Notification") {
    try {
      await processSesEvent(JSON.parse(envelope.Message) as SesEvent);
    } catch {
      return NextResponse.json({ error: "Invalid SES event" }, { status: 400 });
    }
  }

  return new NextResponse(null, { status: 204 });
}
