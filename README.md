# Inventory Reservation System

A NestJS service that lets shoppers place a temporary hold on limited stock during a flash sale, then confirm or cancel it. It never oversells, even when hundreds of requests arrive for the last unit at the same moment.

| Level | Requirement | Where it lives |
| --- | --- | --- |
| 1 | Basic reservation, reject when stock is unavailable | `Product.reserve`, `ReservationService.reserve` |
| 2 | Lifecycle (Active, Confirmed, Cancelled, Expired) with a 2-minute hold | `Reservation`, `ReservationExpiryService`, `ExpirySweeper` |
| 3 | No race conditions: stock 1 with 500 simultaneous requests gives 1 success and 499 failures | `KeyedMutex`, `UnitOfWork` adapters, three test suites |

---

## Quick start

Requires Node.js 20 or later.

```bash
npm install
npm run start:dev          # http://localhost:3000, in-memory storage
                           # Swagger UI: http://localhost:3000/docs (OpenAPI JSON: /docs-json)
npm test                   # unit + MongoDB integration + e2e (116 tests)
npm run check              # lint + typecheck + all tests
```

The MongoDB tests download a MongoDB binary through `mongodb-memory-server` on first run. Nothing needs to be installed.

### Running against MongoDB (optional)

The default storage is in memory, as Level 1 asks. A MongoDB adapter is included to show how the design scales to several instances. Transactions need a replica set, so a script starts a throwaway one:

```bash
npm run mongo:dev                                    # prints MONGO_URL=...
STORAGE_DRIVER=mongo MONGO_URL="<printed url>" npm run start:dev
```

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `STORAGE_DRIVER` | `memory` | `memory` or `mongo` |
| `MONGO_URL` / `MONGO_DB_NAME` | none / `inventory` | Required when `STORAGE_DRIVER=mongo` |
| `RESERVATION_HOLD_MS` | `120000` | How long a reservation holds stock (spec: 2 minutes) |
| `EXPIRY_SWEEP_INTERVAL_MS` | `5000` | Background sweep interval. `0` disables it, and lazy expiry still applies |

Invalid configuration fails at startup with a clear message.

---

## API

Interactive documentation is served at **`/docs`** (Swagger UI), with the raw OpenAPI document at **`/docs-json`**.

| Method | Path | Body | Success | Errors |
| --- | --- | --- | --- | --- |
| `POST` | `/products` | `{ "name": "Sneaker", "totalStock": 1 }` | `201` product | `400` |
| `GET` | `/products/:productId` | | `200` product with live `availableStock` | `404` |
| `POST` | `/products/:productId/reservations` | `{ "userId": "alice", "quantity": 1 }` (`quantity` defaults to 1) | `201` reservation (`ACTIVE`) | `400`, `404`, `409 INSUFFICIENT_STOCK` |
| `GET` | `/reservations/:reservationId` | | `200` reservation | `404` |
| `POST` | `/reservations/:reservationId/confirm` | | `200` reservation (`CONFIRMED`) | `404`, `409 INVALID_RESERVATION_STATE`, `410 RESERVATION_EXPIRED` |
| `POST` | `/reservations/:reservationId/cancel` | | `200` reservation (`CANCELLED`) | `404`, `409 INVALID_RESERVATION_STATE`, `410 RESERVATION_EXPIRED` |

Business-rule errors share one shape:

```json
{ "statusCode": 409, "error": "INSUFFICIENT_STOCK", "message": "Cannot reserve 1 unit(s) of product …: only 0 available" }
```

Example session:

```bash
PRODUCT=$(curl -s -XPOST localhost:3000/products -H 'content-type: application/json' \
  -d '{"name":"Sneaker","totalStock":1}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')

curl -s -XPOST localhost:3000/products/$PRODUCT/reservations \
  -H 'content-type: application/json' -d '{"userId":"alice"}'        # 201 ACTIVE
curl -s -XPOST localhost:3000/products/$PRODUCT/reservations \
  -H 'content-type: application/json' -d '{"userId":"bob"}'          # 409 INSUFFICIENT_STOCK
```

---

## Design

### Layers (ports and adapters)

```
src/
├── config/                       env → validated AppConfig
└── inventory/
    ├── domain/                   pure TypeScript: no Nest, no I/O
    │   ├── product.ts            stock ledger aggregate (available = total − sold − reserved)
    │   ├── reservation.ts        reservation state machine
    │   ├── reservation-status.ts transition table
    │   └── errors.ts             typed business errors
    ├── application/              use cases; depend only on ports
    │   ├── ports/                UnitOfWork, repositories, Clock
    │   ├── reservation.service.ts
    │   ├── product.service.ts
    │   ├── reservation-expiry.service.ts
    │   └── expiry-sweeper.ts
    ├── infrastructure/           adapters behind the ports
    │   ├── concurrency/          KeyedMutex (per-product async lock)
    │   ├── memory/               in-memory UnitOfWork (default)
    │   ├── mongo/                MongoDB UnitOfWork (optional)
    │   └── persistence/          picks the adapter from config
    └── http/                     controllers, DTOs, error → status mapping
```

Dependencies point inward. The domain knows nothing about Nest or storage. Application services depend on the `UnitOfWork` and `Clock` interfaces, not on implementations. Swapping in-memory storage for MongoDB is a configuration change, and both adapters pass the same contract test suite in [test/contracts](test/contracts/unit-of-work.contract.ts).

### Domain model

**`Product`** is the stock ledger. It stores `totalStock`, `reservedQuantity` and `soldQuantity`, and derives `availableStock = total − sold − reserved`. That is the formula from the brief, so it can never drift from the counters. Stock moves along only three paths, and every method validates before mutating:

```
available ──reserve──▶ reserved ──confirmSale──▶ sold   (irreversible)
    ▲                     │
    └──releaseReservation─┘   (cancel or expiry)
```

**`Reservation`** is a state machine whose transitions are declared in one table. `ACTIVE` is the only non-terminal state, which is how "confirmed purchases cannot be reversed" is enforced:

```
ACTIVE ──confirm──▶ CONFIRMED
   ├────cancel───▶ CANCELLED
   └────expire───▶ EXPIRED
```

Every time-dependent method takes `now` as an argument, so the entities are pure and deterministic to test.

---

## Locking strategy

### Where the race comes from in Node.js

Node.js runs JavaScript on one thread, so two callbacks never execute at the same instant. An `async` function still gives up control at every `await`, and each use case is a read-check-write sequence:

```ts
const product = await repo.findById(id);   // ← 499 other requests run here…
product.reserve(1);                        //   …and all of them saw "1 available"
await repo.save(product);
```

Without coordination, all 500 requests read "1 available" before any of them saves. The test suite proves this rather than asserting it. A control experiment swaps the lock for a no-op and shows the same scenario oversells: see "control experiment" in [reservation.concurrency.spec.ts](src/inventory/application/reservation.concurrency.spec.ts).

### The single concurrency boundary: `UnitOfWork.runExclusive(productId, work)`

Every state change affects exactly one product's stock, so isolation is scoped **per product**. Every use case (reserve, confirm, cancel, expire) is a single `runExclusive` block on its product. The port guarantees two things:

1. **Isolation.** No other work on the same product interleaves with the block.
2. **Atomicity.** If the block throws, none of its writes are persisted.

Application services state *what* must be atomic. Each adapter decides *how*.

### In-memory adapter: pessimistic, per-product mutex

[`KeyedMutex`](src/inventory/infrastructure/concurrency/keyed-mutex.ts) is an async mutex per product id:

- **Serialises per product.** Requests for the same product queue on a promise chain, and each one runs its whole read-check-write while holding the lock.
- **FIFO and fair.** Waiters are served in arrival order, with no polling and no starvation.
- **Parallel across products.** A flash sale on one product never slows down another; a test covers this.
- **Deadlock-free.** A use case only ever holds one lock, and the lock is released in `finally` even when the work throws.
- **Bounded memory.** A key's entry is removed when its queue drains.

Writes go to a staged copy that is committed synchronously at the end, so a failed use case leaves no partial state.

I chose a mutex over a lock-free compare-and-set for three reasons:

- The critical section is tiny and fully in memory, so queuing costs almost nothing.
- The business rules stay in the domain objects instead of being re-encoded as conditional updates.
- It is the simplest thing to reason about and explain.

### MongoDB adapter: mutex within a process, transactions across processes

An in-process lock cannot coordinate two server instances, so [`MongoUnitOfWork`](src/inventory/infrastructure/mongo/mongo-unit-of-work.ts) adds a second layer:

- **Within a process,** the same `KeyedMutex` queues requests, so an instance never conflicts with itself and retries stay rare.
- **Across processes,** every unit of work is a multi-document transaction with snapshot reads and majority writes.
- **The product document is the conflict point.** Every state-changing use case writes it, so when two instances race on the same product, MongoDB aborts one transaction with a `WriteConflict`.
- **Retries see fresh data.** The driver's `withTransaction` re-runs the callback against current state, where the domain rule rejects the oversell.
- **Writes commit together.** Product and reservation changes commit at once or not at all.

A test runs two independent instances, with separate clients and separate locks, against one database. They still grant exactly as many reservations as there is stock.

---

## Expiry

A reservation holds stock for 2 minutes (configurable). Expiry runs on two paths:

1. **Lazy, which guarantees correctness.** Every operation on a product first releases that product's lapsed holds, inside the same `runExclusive` block. A reservation is also treated as lapsed the instant `now >= expiresAt`, even before anything marks it `EXPIRED`. So a late confirm is always rejected, and stock always comes back on the next request. This works with no timers at all.
2. **Proactive, which keeps data fresh.** [`ExpirySweeper`](src/inventory/application/expiry-sweeper.ts) periodically releases lapsed holds across all products, so stock and statuses stay current for products nobody is touching. Sweeps never overlap, the timer is `unref`'d and cleared on shutdown, and a failure on one product is logged without blocking the others.

A MongoDB TTL index is deliberately not used. It deletes documents roughly once a minute without returning their stock to the product.

If a confirm and an expiry race at the deadline, they serialise on the product lock. The confirm either wins before the deadline or fails with `410 RESERVATION_EXPIRED`. That status is the same whichever path recorded the expiry first.

---

## Testing

Development was test-first. For the domain model, the mutex and the use cases, the git history has a commit with the failing spec before each implementation commit.

| Suite | Command | What it covers |
| --- | --- | --- |
| Unit | `npm run test:unit` | Domain rules, state machine, mutex, in-memory adapter contract, use cases, sweeper, config |
| Concurrency | part of unit | 500 requests on stock 1, 500 on stock 10, mixed quantities, confirm/cancel races, confirm-versus-sweeper at the deadline, a full flash-sale lifecycle, and a no-lock control experiment that oversells |
| MongoDB | `npm run test:mongo` | The same adapter contract on a real replica set, 500 concurrent requests, two independent instances sharing one database |
| E2E | `npm run test:e2e` | The real HTTP pipeline: validation, status codes, lifecycle, and 500 concurrent HTTP requests for the last unit |

Time is controlled by an injected `FakeClock`, so expiry tests never sleep. Coverage is about 99% of statements, and CI enforces a threshold.

---

## Assumptions

- **No authentication.** The client sends `userId`, and identity is out of scope.
- **Products are created through the API.** There is no product catalogue beyond name and stock.
- **Reservations can hold several units.** `quantity` must be at least 1 and defaults to 1.
- **No per-user limit.** A user may hold several reservations; the brief does not limit this.
- **Expiry is inclusive.** A hold is over at exactly `createdAt + 2 minutes`.
- **Confirm means payment succeeded.** Payment itself is out of scope.

## Trade-offs

- **Serialising per product caps throughput on one hot product.** The critical section is microseconds in memory, so this is far above flash-sale needs. At much larger scale, stock could be split into buckets or decremented atomically in Redis.
- **Lazy expiry is rolled back when a reservation request fails.** If a lapsed hold is released and the new reservation still fails, the whole transaction rolls back, including the release. The hold stays `ACTIVE` until the next operation or sweep. This never oversells; it only delays an internal status change.
- **Reads take the product lock.** `GET` endpoints apply lazy expiry, so they always return current availability, at the cost of briefly queuing behind writes.
- **In-memory state is lost on restart.** That is acceptable for Level 1, and the MongoDB adapter provides durability.

## What I would add next

- **Idempotency keys** on reserve and confirm, so client retries after a timeout cannot double-book.
- **A per-user purchase limit,** which is common in flash sales.
- **Observability:** metrics for lock wait time, transaction retries, and reservations per status.
- **An outbox for domain events** such as `ReservationConfirmed`, for downstream order and payment services.
- **Rate limiting and a queue in front of hot products** to absorb bursts above capacity.

---

## AI usage disclosure

As requested in the challenge brief, here is how AI was used in this submission.

### Which AI tools did you use?

**Claude Code**, Anthropic's coding assistant, running in VS Code. No other AI tools were used. Every AI-assisted commit carries a `Co-Authored-By: Claude` trailer, so the git history itself shows what was generated.

### How did you use them?

I used Claude as a pair programmer, with myself in the role of reviewer and decision-maker:

1. **Design discussion before any code.** I shared the challenge PDF and the email and proposed NestJS with MongoDB. Claude pointed out that Level 1 asks for in-memory state and that making MongoDB the core would hand the concurrency problem to the database. Reviewers would then see less of the locking strategy. We agreed on an in-memory core behind a `UnitOfWork` port, with MongoDB as an optional adapter. I approved that design before implementation started.
2. **Test-first implementation, level by level.** Claude wrote a failing spec, committed it, implemented until it passed, and committed again. It ran the tests, lint, typecheck and build at each step.
3. **Verification beyond unit tests.** The built server was run locally in both storage modes. It was hit with concurrent `curl` requests, including 200 parallel requests against a real MongoDB replica set: 1 succeeded and 199 were rejected.
4. **Follow-up requests.** I asked for Swagger documentation, which was added at `/docs`.

### What portions of the solution were AI-assisted?

| Part | Who |
| --- | --- |
| Problem framing, choice of NestJS, approving the architecture | Me, after discussion with Claude |
| Architecture and locking strategy proposal | Claude, reviewed and accepted by me |
| Production code (domain, services, adapters, HTTP layer, config) | Generated by Claude |
| Tests (unit, concurrency, MongoDB integration, e2e) | Generated by Claude |
| README, CI workflow, commit messages | Generated by Claude |
| Review of design, code and test results; accountability for the submission | Me |

I treat the code as my own submission: I have reviewed it and can explain and defend every design decision in it.

### Prompts and workflow

The main prompts were short and direction-setting rather than line-by-line:

- *"Here is the assessment and the recruiter's email. I think we should use NestJS and MongoDB. Anything else you would suggest? Let's discuss before implementing."*
- *"Go with the approach you recommended."*
- *"Give me the URL path for Swagger."* This led to adding Swagger, because it did not exist yet.

What worked well was agreeing the design first, then insisting on test-first commits. The concurrency suite caught two real bugs, each fixed in its own commit:

- A confirm that lost a race with the expiry sweeper returned a generic state error instead of `RESERVATION_EXPIRED`.
- One product with inconsistent data could abort the whole expiry sweep and block stock release for every other product.
