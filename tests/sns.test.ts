import { describe, expect, it } from "vitest";
import { isAllowedSnsUrl, snsCanonicalString, type SnsEnvelope } from "@/lib/sns";

const ENVELOPE: SnsEnvelope = {
  Type: "Notification",
  MessageId: "message-id",
  TopicArn: "arn:aws:sns:us-east-1:123456789012:get2gethr-ses",
  Message: "{\"eventType\":\"DELIVERY\"}",
  Timestamp: "2026-09-01T00:00:00.000Z",
  SignatureVersion: "2",
  Signature: "signature",
  SigningCertURL:
    "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem",
};

describe("SNS verification", () => {
  it("allows only AWS SNS HTTPS hosts", () => {
    expect(isAllowedSnsUrl(ENVELOPE.SigningCertURL)).toBe(true);
    expect(isAllowedSnsUrl("http://sns.us-east-1.amazonaws.com/cert.pem")).toBe(false);
    expect(isAllowedSnsUrl("https://sns.us-east-1.amazonaws.com.evil.test/cert.pem")).toBe(
      false
    );
    expect(isAllowedSnsUrl("https://attacker@sns.us-east-1.amazonaws.com/cert.pem")).toBe(
      false
    );
  });

  it("builds the exact notification canonical form", () => {
    expect(snsCanonicalString(ENVELOPE)).toBe(
      [
        "Message",
        ENVELOPE.Message,
        "MessageId",
        ENVELOPE.MessageId,
        "Timestamp",
        ENVELOPE.Timestamp,
        "TopicArn",
        ENVELOPE.TopicArn,
        "Type",
        ENVELOPE.Type,
        "",
      ].join("\n")
    );
  });
});
