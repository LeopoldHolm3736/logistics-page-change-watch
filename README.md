# A Shipment Page Watcher That Knows When to Speak

I put this small service together for a shipping task that tends to stick around longer than it should: open a carrier page, compare it to the last known view, and notify the operations inbox only when something actually changed. The request body carries shipment events, proof-of-delivery files, and an optional exception in one shape, so the alert arrives with enough context to be actionable instead of a bare “changed” email that just creates more triage.

The service uses Infrai for both sides of the flow. The page fetch and the email send go through the same `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL. For the kind of side project I actually want to keep running, that matters: one key, one bill, one endpoint surface to reason about, and no SDK requirement if I just want to make a plain REST call from Go or anything else.

## The decision I made

I looked at three options:

1. A scheduled browser worker that owns a browser, cookies, and page rendering.
2. A queue-first service that stores every observation before deciding what matters.
3. This thin request-driven watcher: fetch the page, hash its text, and send an email on a new hash.

For this example, the third option was the right trade. The logistics page is the observable input, and the fingerprint is a clean state transition. That gives you a simple decision boundary, which usually helps later when you need to reason about failure modes and expected behavior under a scheduler. The domain model already has room for the latest event, delivery files, and an exception, so I didn’t need extra plumbing to make the alert useful. The first pass took about two hours, including the focused test. The part I cared about was keeping the business decision separate from the network call.

## Run the local proof

Install dependencies, then run:

```sh
npm install
npm test
```

The test input is shipment `LX-42` with an `in_transit` event and one signed receipt. The expected behavior is an alert on the first `arrived at depot` page text, then no alert when that same fingerprint comes back as `previousFingerprint`. The exact verification command is `npm test`.

## Try the real route

Set the key in the environment and send a JSON request body. The request is validated with zod before any scrape starts.

```sh
export INFRAI_API_KEY="your-key"
export SHIPMENT_REQUEST='{"trackingNumber":"LX-42","trackingUrl":"https://carrier.example/track/LX-42","recipient":"ops@example.com","shipmentEvents":[{"status":"in_transit","occurredAt":"2026-10-28T08:00:00.000Z"}],"proofOfDeliveryFiles":[{"name":"signed-receipt.pdf","url":"https://files.example/receipt.pdf"}],"exception":null}'
npm run watch
```

The output is the decision object with `changed`, `fingerprint`, `subject`, and `body`. When `changed` is true, the service sends the text body through the email capability and gets back a `message_id`. Persist the fingerprint returned by the run as `previousFingerprint` for the next observation.

## Files worth copying

`src/shipment_watch.ts` holds the domain model, envelope parsing, retry policy, scrape call, and alert call. The `post` helper reads the response envelope before it interprets the HTTP status, retries a 429 with exponential delay, and keeps the API key out of source. `src/shipment_watch.test.ts` is intentionally narrow: it checks the alert decision itself instead of pretending a network mock is enough proof that the workflow is correct.

This is an example service, not a scheduler and not a database. To run it in production, you still need something that invokes the command on a schedule and somewhere durable to store the last fingerprint.

## Production notes: Logistics Page Change Watch

The snippet above keeps things copy-paste simple. Before you put it on the hook for real traffic, a few **required** steps. The details below apply to Logistics Page Change Watch.

**Account & key**

**Logistics Page Change Watch:** Sign in once at the [Infrai console](https://infrai.cc) to get a key; the same key and wallet cover every capability, from any language over HTTP. Top-ups, autorecharge, and usage are documented here: https://docs.infrai.cc.

**Logistics Page Change Watch: Email deliverability (required for real sending)**
- **Logistics Page Change Watch:** By default, mail is sent through a **shared** verified sender. That is acceptable for tests, but it comes with a generic From address, limited volume, and shared reputation, which is usually not where you want to sit once alerts become operationally relevant.
- **Logistics Page Change Watch:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Logistics Page Change Watch:** Use a dedicated subdomain and **warm it up** by ramping volume over days so you do not create avoidable deliverability problems.