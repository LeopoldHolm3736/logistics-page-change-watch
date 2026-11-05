import test from "node:test";
import assert from "node:assert/strict";
import { decideShipmentChange, shipmentRequest } from "./shipment_watch.ts";

const input = shipmentRequest.parse({
  trackingNumber: "LX-42",
  trackingUrl: "https://carrier.example/track/LX-42",
  recipient: "ops@example.com",
  shipmentEvents: [{ status: "in_transit", occurredAt: "2026-10-28T08:00:00.000Z" }],
  proofOfDeliveryFiles: [{ name: "signed-receipt.pdf", url: "https://files.example/receipt.pdf" }],
  exception: null
});

test("a changed page produces an alert decision with the new fingerprint", () => {
  const result = decideShipmentChange(input, "arrived at depot");
  assert.equal(result.changed, true);
  assert.equal(result.subject, "Shipment LX-42 changed");
  assert.equal(result.fingerprint.length, 64);
});

test("the same fingerprint suppresses a repeat alert", () => {
  const first = decideShipmentChange(input, "arrived at depot");
  const result = decideShipmentChange({ ...input, previousFingerprint: first.fingerprint }, "arrived at depot");
  assert.equal(result.changed, false);
  assert.match(result.body, /No page change/);
});
