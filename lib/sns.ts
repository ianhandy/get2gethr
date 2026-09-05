import { createVerify } from "node:crypto";

export interface SnsEnvelope {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: "1" | "2";
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
}

const certificateCache = new Map<string, string>();

export function isAllowedSnsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      /^sns(?:\.[a-z0-9-]+)?\.amazonaws\.com$/i.test(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function snsCanonicalString(message: SnsEnvelope): string {
  const fields: Array<keyof SnsEnvelope> =
    message.Type === "Notification"
      ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
      : [
          "Message",
          "MessageId",
          "SubscribeURL",
          "Timestamp",
          "Token",
          "TopicArn",
          "Type",
        ];

  let canonical = "";
  for (const field of fields) {
    const value = message[field];
    if (value !== undefined) canonical += `${field}\n${value}\n`;
  }
  return canonical;
}

export async function verifySnsEnvelope(
  message: SnsEnvelope,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  if (
    !["Notification", "SubscriptionConfirmation", "UnsubscribeConfirmation"].includes(
      message.Type
    ) ||
    !["1", "2"].includes(message.SignatureVersion) ||
    !isAllowedSnsUrl(message.SigningCertURL)
  ) {
    return false;
  }

  let certificate = certificateCache.get(message.SigningCertURL);
  if (!certificate) {
    const response = await fetchImpl(message.SigningCertURL, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    certificate = await response.text();
    certificateCache.set(message.SigningCertURL, certificate);
  }

  const verifier = createVerify(message.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1");
  verifier.update(snsCanonicalString(message), "utf8");
  verifier.end();
  return verifier.verify(certificate, Buffer.from(message.Signature, "base64"));
}
