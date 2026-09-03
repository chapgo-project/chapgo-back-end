# Handover — chapgo-api

For the developer picking this up. Written to be read in fifteen minutes.

---

## What this is, and what it is not

**Is:** a written Node.js/TypeScript/MongoDB backend — 18 collection models,
the authorization core, 42 working endpoints, 6 scheduled jobs, seed data, and
three test suites including a full authorization matrix.

**Is not:** compiled, executed, deployed, or connected to Atlas. There is no
production URL. `npm install`, `tsc` and `vitest` have **never been run**
against it.

Read that plainly: the design decisions are made and the hard logic is
written, but **your first job is to make it compile**. Expect import-path and
type fixes. Half a day is a fair estimate; two days if TypeScript strict mode
is unfamiliar.

---

## First hour

```bash
npm install
cp .env.example .env
# openssl rand -base64 48    → JWT_ACCESS_SECRET
# openssl rand -base64 48    → JWT_REFRESH_SECRET

docker run -d -p 27017:27017 --name chapgo-mongo mongo:7 --replSet rs0
docker exec chapgo-mongo mongosh --eval 'rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:27017" }] })'
# MONGODB_URI=mongodb://127.0.0.1:27017/chapgo?replicaSet=rs0

npm run typecheck    # ← start here, fix what it reports
npm test             # then here
npm run seed
npm run dev
```

If `npm test` hangs on start, it is `mongodb-memory-server` downloading a
binary. It caches after the first run.

---

## Read the code in this order

1. **`src/core/errors.ts`** — the error codes cross the wire to Flutter.
   Renaming one breaks a UI error state silently.
2. **`src/core/authorization.ts`** — the single most important file. Every
   vehicle-scoped route goes through `resolveVehicleScope()`.
3. **`test/authorization.test.ts`** — the authorization matrix. If you read
   only one thing, read this: it documents the intended behaviour more
   precisely than prose.
4. **`src/modules/maintenance/maintenance.service.ts`** — the heart. The
   transaction, the versioning, the nine side effects.
5. **`src/modules/reminders/status.ts`** — the stale-mileage honesty rule.
6. **`src/modules/mileage/mileage.service.ts`** — the regression rule.

Everything else is ordinary CRUD by comparison.

---

## Five things that will bite you if you skip them

| # | Trap | Why |
|---|---|---|
| 1 | **Standalone MongoDB** | `withTransaction` throws. Locally *and* in CI you need a replica set. |
| 2 | **Renaming a JSON field** | Flutter's `fromJson` breaks silently — no error, an empty screen. Match `lib/shared/models/*.dart`. |
| 3 | **Cron inside the web service** | Render sleeps the web service. Reminders stop, and nothing tells you. Use the separate cron service in `render.yaml`. |
| 4 | **Checking permissions in a controller** | Use `resolveVehicleScope`. One route written without it is the whole breach. |
| 5 | **Free Render tier** | 30–60 s cold start. A garage at the counter reads that as a broken app. |

---

## What to build next, in order

Models and services exist for all of it; routes are missing.

```
Week 1   Make it compile · reminders routes · issues routes
Week 2   Documents routes · attachments (needs the S3 client)
Week 3   Deploy to Render staging · point Flutter at it · swap
         MockAuthRepository → ApiAuthRepository
Week 4   Vehicles + mileage + maintenance integration, one provider at a time
Week 5   Dashboard aggregate (LAST — it aggregates everything above)
Week 6   Hardening: rate limits, backups, monitoring, load check
         ── driver app can ship ──
Week 7+  Garage: accounts, access lifecycle, intervention review
```

Do not build the garage backend before the garage UI is designed. You would
be guessing at screens that do not exist.

---

## How to know it is working

Not "the endpoints return 200". These five:

1. `npm test` green — especially the authorization matrix.
2. A garage with a **revoked** grant gets `ACCESS_DENIED`, not data.
3. An **accepted** intervention cannot be modified in place by anyone.
4. A mileage regression is impossible without a stated reason.
5. The Flutter app runs against staging with **zero screen changes**.

---

## Where the answers are

| Question | Document |
|---|---|
| Why is it built this way? | `ChapGo - Backend Brief` (design doc) |
| What does each endpoint do? | `docs/api/*.md` in `chapgo-mobile` |
| What does each screen need? | `docs/api/SCREEN_API_MAPPING.md` |
| What are the exact field names? | `chapgo-mobile/lib/shared/models/*.dart` — **the real contract** |
| What are the auth payloads? | `docs/api/AUTH_API_CONTRACT.md` |
| Which screens exist? | `ChapGo V1 - Handoff` (design doc) |

When code and a document disagree, **the Dart models win**. They are what
ships to users.
