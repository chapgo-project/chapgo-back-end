# chapgo-api

Backend for **ChapGo** — the digital vehicle health record. Node.js 20 ·
TypeScript · MongoDB · deployed on Render.

Serves two clients from **one shared dataset**: the Flutter driver app
(built, 100 screens) and the garage interface (architected, not yet built).

---

## Status — read this first

| Area | State |
|---|---|
| Project skeleton, TypeScript, config, error envelope | **Written** |
| 18 collection models with indexes | **Written** |
| Authorization resolver + 3-layer middleware | **Written** |
| Auth module — 13 endpoints | **Written** |
| Users — 6 endpoints | **Written** |
| Vehicles, mileage, health — 12 endpoints | **Written** |
| Maintenance — 11 endpoints, transactional, versioned | **Written** |
| Scheduled jobs — 6 sweeps | **Written** |
| Seed — 11 templates + pricing grid | **Written** |
| Tests — authorization matrix, 10 business rules, auth flows | **Written** |
| Reminders / issues / documents / attachments routes | **Models + services ready, routes to add** |
| Garage, access, subscriptions, admin routes | **Models ready, routes to add** |
| **Never executed** | `npm install`, `tsc`, `vitest` have not been run |

> **The code has not been compiled or executed.** It was written against the
> Flutter contract and the architecture documents, but expect to fix import
> paths and type errors on the first `npm run typecheck`. Budget half a day.

---

## Quick start

```bash
npm install
cp .env.example .env      # fill MONGODB_URI and both JWT secrets

# openssl rand -base64 48   → for each secret

npm run typecheck         # do this FIRST
npm run seed              # templates + pricing grid
npm run dev               # http://localhost:3000
npm test
```

**MongoDB must be a replica set.** Several services write inside a
transaction; a standalone `mongod` rejects transactions outright. Atlas gives
you one by default. Locally:

```bash
docker run -d -p 27017:27017 --name chapgo-mongo mongo:7 --replSet rs0
docker exec chapgo-mongo mongosh --eval 'rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] })'
```

---

## Architecture

```
src/
  core/          config · db · errors · http · tokens · password
                 authMiddleware · authorization · validate
                 idempotency · rateLimit · messaging · logger
  modules/       one folder per domain
    <domain>/    model.ts · schema.ts (Zod) · service.ts
                 routes.ts · dto.ts
  jobs/          scheduled sweeps (separate Render service)
  scripts/       seed
  types/         enums, mirrored from Dart
test/            setup · factories · authorization · businessRules · auth
```

One folder per domain. The alternative — top-level `controllers/`,
`models/`, `services/` — forces you into four directories to change one
endpoint.

### The one decision that shapes everything

**The vehicle record is one shared resource.** A maintenance event written by
a driver and one written by a garage are the *same* document with a different
`provenance` and a different permission path. There is no
`/garage/vehicles/…` mirror: it would fork validation, versioning,
attachments and the timeline — roughly 20 endpoints of duplication.

A garage reads `GET /vehicles/:id`, the same as the owner. The response is
**scoped**, not filtered after the fact.

---

## Authorization — the part to get right

Three layers, in order:

| Layer | Where | Checks |
|---|---|---|
| 1 · Authentication | `requireAuth` | valid access token |
| 1b · Live account | `requireLiveAccount` | account not deleted |
| 2 · Role | `requireRole`, `requireVerifiedGarage` | `owner` / `garage` / `admin`; a garage must be **verified** |
| 3 · Resource | `resolveVehicleScope()` | ownership, or an approved unexpired grant |

```ts
const scope = await resolveVehicleScope(actorOf(req), vehicleId, { forWrite: true });
assertCanWrite(scope);
```

**Written once, deliberately.** Re-implementing the check per controller is
how one route eventually ships without it, and that single route is the
breach. The returned scope also drives serialization.

Never trust Flutter to decide access. The app hides buttons; the API refuses
requests.

---

## Business rules that are not CRUD

Ten rules, each covered by a test in `test/businessRules.test.ts`.

1. **Mileage never regresses silently** — a lower value is refused. A
   correction may lower it *with a reason*, and the original entry stays. An
   implausible jump (> 50 000 km) returns a **soft warning** the client
   confirms: a genuinely neglected car exists.
2. **The reference reading is the most recent taken ON the vehicle** — not
   the highest. A garage reading beats a remote owner entry whatever the value.
3. **Reminder status is derived, and honest** — `first_of` fires on whichever
   of date or mileage comes first. But with a two-month-old odometer the
   backend does **not** claim the mileage threshold was crossed: it returns
   `mileageStale` and the app says "update your mileage".
4. **Accepted professional records are append-only** — `PATCH` returns
   `EVENT_LOCKED` for the garage *and* the owner. A correction creates a new
   version; both stay readable.
5. **Creating an event is a transaction** — up to nine writes across six
   collections. Half-applied, the record is inconsistent.
6. **A transfer revokes everything tied to the previous ownership** — grants
   are bound to an `ownershipId`, so a garage authorised by the seller cannot
   reach the buyer even if the revocation sweep failed.
7. **A garage proposes, it does not impose** — recommendations land as
   `proposed` reminders. The guard against garages driving return visits.
8. **Deletion anonymises, it does not erase** — vehicle history is retained;
   it belongs to the vehicle.
9. **Recovery reveals nothing** — forgot-password always returns 200; login
   never says which field was wrong; plate lookup returns a vague
   `VEHICLE_NOT_FOUND`.
10. **Provisional customers are claimed, never auto-linked** — matching on
    phone alone would eventually hand one person's history to another.

---

## Conventions

**Success** `{ "data": … }` · lists add `meta`.
**Error** `{ "error": { "code", "message", "field? " } }` — `code` stable,
`message` **French and displayable as-is**, `field` when it belongs to one
input. The Flutter error mapper expects exactly this.

- Cursor pagination on timelines, page numbers elsewhere.
- `Idempotency-Key` **required** on mileage creation, maintenance creation,
  transfer acceptance and upload finalisation. Abidjan networks retry, and a
  duplicated intervention is visible to the customer.
- UTC ISO-8601 for instants; `YYYY-MM-DD` for calendar dates.
- **Field names must match the Dart models exactly** — a rename means editing
  18 models.

---

## Files

Never through the API:

```
POST /uploads              → { fileId, uploadUrl, expiresAt }
PUT  <uploadUrl>           → binary straight to object storage
POST /uploads/:id/complete → verifies, reads dimensions → ready
```

Reads use 15-minute signed URLs. No public bucket. **Cloudflare R2 or
Backblaze B2** over AWS S3 — no egress fees, which matters when a garage
opens twenty photos on mobile data.

---

## Scheduled jobs

A **separate Render cron service** (`npm run jobs:start`). A sleeping web
service runs no cron, and silently stopped reminders are the worst failure
mode here: the app looks fine while doing nothing.

Six sweeps, each isolated so one failure does not cancel the rest: reminders,
documents, access expiry, stale mileage, orphaned uploads, health caches.

---

## Deployment

`render.yaml` is committed — the setup is reproducible, not clicked.

- `/healthz` checks **Mongo connectivity**, not just process liveness.
- **Do not use Render's free tier**: a cold start adds 30–60 s, which reads
  as a broken app to a garage at the counter.
- Atlas: replica set, IP allowlist for Render egress, least-privilege user,
  backups on.
- Logs are structured and **redact PII** — no phone, email, plate or token.

---

## What is left to build

Models and services exist; the routes do not:

| Domain | Effort | Notes |
|---|---|---|
| Reminders | ~1 day | Service logic is written (`status.ts`); wire CRUD + complete/postpone |
| Issues | ~0.5 day | Model complete; CRUD + status/resolve |
| Documents | ~0.5 day | Model complete; CRUD |
| Attachments | ~1 day | Needs the S3 client; the two-step flow is specified |
| Garages + access | ~3 days | Models complete; the lifecycle is in the architecture doc |
| Subscriptions | ~1 day | Counters, limits guard, pricing grid read |
| Admin | ~1 day | Garage validation is the only blocking piece |
| Dashboard | ~0.5 day | Aggregates the above — **build last** |
| PDF generation | ~2 days | Async, polled |

**Ship the driver app before the garage side.** 9–11 weeks to a real product
versus 18–21 before anything ships — and the garage UI is not designed yet, so
building its backend now means guessing at screens that do not exist.

---

## Flutter integration

```
lib/data/repositories/   interfaces          ← unchanged
lib/data/mock/           MockXRepository     ← keep, useful as fixtures
lib/data/api/            ApiXRepository      ← add
lib/app/providers.dart                       ← one line per domain
```

Swap one provider at a time and verify against staging. Mixing real and mock
repositories is fine, and makes regressions obvious. **No screen changes.**

On a failed refresh, call
`ref.read(authControllerProvider.notifier).sessionExpired()` — the router
guard handles the rest.

---

## Decisions to confirm

Three change the schema and are expensive to revisit:

1. **Owner acceptance of garage interventions** — implemented as *required*.
   Auto-accept would remove the review states entirely.
2. **History-sharing scope** — implemented as *per grant*, and both the
   ownership flag and the grant flag must agree.
3. **Offline drafts** — **not implemented**. A mechanic with poor signal will
   lose a half-filled intervention. Adds 2–3 weeks and a conflict model.

Also open: SMS provider (test Ivorian delivery rates before committing —
this is where OTP flows fail quietly), push provider, and what happens at the
plan ceiling (recommended: read fully, write blocked; never hide data a
garage produced).
