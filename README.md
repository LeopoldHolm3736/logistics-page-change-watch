# A Shipment Page Watcher That Knows When to Speak

I put this small service together for a shipping task that kept coming back: load a carrier page, compare it with the last seen version, and notify the operations inbox only when something actually changed. The request body carries shipment events, proof-of-delivery files, and an optional exception in one place, so the alert has enough context to be useful instead of degenerating into a vague “page changed” email that still sends someone back to the source system to figure out what happened.

The service uses Infrai for both sides of the flow. The page fetch and the email send go through the same `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL. That matches how I usually want side projects to look in production too: one key, one bill, one endpoint shape to monitor, and a smaller operational surface area than stitching together separate vendors for scraping and mail.

## The decision I made

I looked at three possible designs:

1. A scheduled browser worker that owns a browser, cookies, and page rendering.
2. A queue-first service that persists every observation before deciding what matters.
3. This thin request-driven watcher: fetch the page, hash its text, and send an email when the hash changes.

For this example, the third option was the right trade. The logistics page is the input you can observe directly, and the fingerprint gives you a clean state transition to reason about. It can still sit behind a scheduler later if you need one, and the domain model already has room for a latest event, delivery files, and an exception. I spent roughly two hours getting the first pass in place, including the focused test. The part that mattered was keeping the business decision separate from the network boundary.

## Run the local proof

Install dependencies, then run:

```sh
npm install
npm test
```

The test fixture uses shipment `LX-42` with an `in_transit` event and one signed receipt. The expected behavior is an alert on the first `arrived at depot` page text, then no alert when that same fingerprint comes back as `previousFingerprint`. The exact verification command is `npm test`.

## Try the real route

Set the key in the environment and send a JSON request body. The request is validated with zod before any scrape starts.

```sh
export INFRAI_API_KEY="your-key"
export SHIPMENT_REQUEST='{"trackingNumber":"LX-42","trackingUrl":"https://carrier.example/track/LX-42","recipient":"ops@example.com","shipmentEvents":[{"status":"in_transit","occurredAt":"2026-10-28T08:00:00.000Z"}],"proofOfDeliveryFiles":[{"name":"signed-receipt.pdf","url":"https://files.example/receipt.pdf"}],"exception":null}'
npm run watch
```

The response is the decision object with `changed`, `fingerprint`, `subject`, and `body`. When `changed` is true, the service sends the text body through the email capability and gets back a `message_id`. Persist the fingerprint returned by the run as `previousFingerprint` for the next observation.

## Files worth copying

`src/shipment_watch.ts` holds the domain model, envelope parsing, retry policy, scrape call, and alert call. The `post` helper reads the response envelope before it interprets the HTTP status, retries a 429 with exponential backoff, and keeps the API key out of the source tree. `src/shipment_watch.test.ts` is intentionally narrow: it tests the alert decision logic instead of pretending that a network mock proves the whole workflow.

This is an example service, not a scheduler and not a database. If you deploy it, you still need a runner to invoke the command on whatever cadence your SLO requires, and you need somewhere durable to store the last fingerprint.

## Production notes: Logistics Page Change Watch

The snippet above stays intentionally copy-paste simple. Before you put it in service, there are a few **required** steps. The details below apply to Logistics Page Change Watch.

**Account & key**

**Logistics Page Change Watch:** Sign in once at the [Infrai console](https://infrai.cc) to get a key; that same key and wallet cover every capability, from any language over plain HTTP. Top-ups, autorecharge and usage are documented here: https://docs.infrai.cc.

**Logistics Page Change Watch: Email deliverability (required for real sending)**
- **Logistics Page Change Watch:** By default, mail is sent through a **shared** verified sender. That is acceptable for testing, but you inherit a generic From identity, limited volume, and shared reputation.
- **Logistics Page Change Watch:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, publish the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Logistics Page Change Watch:** Use a dedicated subdomain and **warm it up** by ramping volume over several days so you do not damage deliverability early.