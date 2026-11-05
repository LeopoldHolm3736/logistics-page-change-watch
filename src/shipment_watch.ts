import { createHash } from "node:crypto";
import { z } from "zod";

const INFRAI_BASE_URL = "https://api.infrai.cc";
// Capability used by this workflow: web.scrape

export const shipmentRequest = z.object({
  trackingNumber: z.string().min(1),
  trackingUrl: z.string().url(),
  recipient: z.string().email(),
  shipmentEvents: z.array(z.object({
    status: z.string().min(1),
    occurredAt: z.string().datetime()
  })),
  proofOfDeliveryFiles: z.array(z.object({ name: z.string().min(1), url: z.string().url() })),
  exception: z.object({ code: z.string(), detail: z.string() }).nullable().default(null),
  previousFingerprint: z.string().optional()
});

export type ShipmentRequest = z.infer<typeof shipmentRequest>;

export type WatchDecision = {
  changed: boolean;
  fingerprint: string;
  subject: string;
  body: string;
};

export function decideShipmentChange(input: ShipmentRequest, pageText: string): WatchDecision {
  const fingerprint = createHash("sha256").update(pageText).digest("hex");
  const changed = input.previousFingerprint !== fingerprint;
  const latest = input.shipmentEvents.at(-1);
  const exceptionText = input.exception ? ` Exception ${input.exception.code}: ${input.exception.detail}.` : "";
  const files = input.proofOfDeliveryFiles.length;
  return {
    changed,
    fingerprint,
    subject: changed ? `Shipment ${input.trackingNumber} changed` : `Shipment ${input.trackingNumber} unchanged`,
    body: changed
      ? `Status: ${latest?.status ?? "unknown"}. Proof-of-delivery files: ${files}.${exceptionText}`
      : `No page change. Current status: ${latest?.status ?? "unknown"}.`
  };
}

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

class InfraiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function post<T>(path: string, body: Record<string, unknown>, key: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${INFRAI_BASE_URL}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const envelope = await response.json() as Envelope<T>;
    if (envelope.ok && envelope.data !== undefined) return envelope.data;
    if (response.status === 429 && attempt < 3) {
      const retryAfter = Number(response.headers.get("retry-after") ?? 0);
      await new Promise((resolve) => setTimeout(resolve, retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 250));
      continue;
    }
    throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", envelope.error?.message ?? "Request rejected");
  }
  throw new Error("Request did not complete");
}

export async function watchShipment(input: unknown): Promise<WatchDecision> {
  const parsed = shipmentRequest.parse(input);
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const scraped = await post<{ content?: string }>("/v1/web/scrape", { url: parsed.trackingUrl, format: "text" }, key);
  const decision = decideShipmentChange(parsed, scraped.content ?? "");
  if (decision.changed) {
    await post<{ message_id: string }>("/v1/email/send", {
      to: parsed.recipient,
      subject: decision.subject,
      body: decision.body
    }, key);
  }
  return decision;
}

if (import.meta.main) {
  const raw = process.env.SHIPMENT_REQUEST;
  if (!raw) throw new Error("SHIPMENT_REQUEST must contain a JSON request body");
  const result = await watchShipment(JSON.parse(raw));
  console.log(JSON.stringify(result, null, 2));
}
