# QueueForge

[![CI](https://github.com/malvin-hoxha/QueueForge/actions/workflows/ci.yml/badge.svg)](https://github.com/malvin-hoxha/QueueForge/actions/workflows/ci.yml)

**QueueForge is a reliable asynchronous job-processing system built with Node.js, PostgreSQL, Redis, and BullMQ.** It demonstrates practical distributed-systems patterns including the **Transactional Outbox**, lease-based publisher coordination, retries and backoff, idempotent queue publishing, poison-event handling, at-least-once processing, and graceful shutdown.

At a glance:

```text
HTTP API
   ↓
PostgreSQL
Job + OutboxEvent
   ↓
Publisher
   ↓
Redis / BullMQ
   ↓
Worker
   ↓
Email / Report
```

The project focuses on the reliability problems that appear when an application accepts work now but executes it later: failed queue publishes, retries, duplicate delivery, concurrent publishers, process crashes, and recovery.

## Architecture

```mermaid
flowchart LR
    Client[Client]
    API[Express API]
    DB[(PostgreSQL)]
    Publisher[Outbox Publisher]
    Redis[(Redis / BullMQ)]
    Worker[Worker]
    Mail[SMTP / Mailpit]
    Files[CSV Reports]

    Client -->|POST /jobs| API
    Client -->|GET /jobs/:id| API

    API -->|Transaction: Job + OutboxEvent| DB

    Publisher -->|Poll + Claim| DB
    Publisher -->|queue.add| Redis

    Redis -->|BullMQ Job| Worker

    Worker -->|Status / Result / Error| DB
    Worker -->|SEND_EMAIL| Mail
    Worker -->|GENERATE_REPORT| Files
```

Main flow:

```text
Client
  ↓
POST /jobs
  ↓
PostgreSQL transaction
  ├── Job
  └── OutboxEvent
  ↓
Publisher
  ↓
BullMQ / Redis
  ↓
Worker
  ↓
Job result persisted in PostgreSQL
  ↓
GET /jobs/:id
```

## Why QueueForge?

A simple background-job implementation might perform two independent operations:

```text
1. Insert Job into PostgreSQL
2. Add Job to Redis / BullMQ
```

This introduces a **dual-write problem**.

PostgreSQL and Redis are separate systems, so a PostgreSQL transaction cannot make both operations atomic.

For example:

```text
Job inserted into PostgreSQL ✅
↓
Process crashes 💥
↓
queue.add() never happens ❌
↓
Job remains WAITING forever
```

QueueForge solves this using the **Transactional Outbox pattern**.

The API writes both the Job and the intent to publish it inside the same PostgreSQL transaction:

```text
PostgreSQL transaction
  ├── Job
  └── OutboxEvent(JOB_CREATED)
```

A separate Publisher later moves the event from PostgreSQL into BullMQ.

## Why BullMQ?

QueueForge intentionally separates two responsibilities:

```text
PostgreSQL
→ durable source of truth

Redis / BullMQ
→ execution queue and worker coordination
```

BullMQ was chosen because it provides a dedicated Redis-backed job execution layer with built-in support for concepts such as retries, backoff, worker coordination, custom job IDs, and stalled-job recovery.

An alternative design could use a PostgreSQL-backed queue such as `pg-boss`, reducing the number of infrastructure components. QueueForge instead keeps the persistence layer and execution queue separate so the project can explicitly explore the failure boundary between a durable relational database and an external message queue.

The goal is not to claim BullMQ is universally better, but to demonstrate the trade-offs and reliability patterns required when PostgreSQL and Redis participate in the same asynchronous workflow.

---

## Distributed Systems & Reliability Concepts

### Dual-Write Problem

A single local transaction cannot normally guarantee atomic writes across two independent systems such as PostgreSQL and Redis.

QueueForge avoids performing the database write and queue publish directly inside the same API request flow.

### Transactional Outbox

`POST /jobs` creates:

```text
Job
+
OutboxEvent
```

inside one Prisma transaction.

Therefore:

```text
transaction succeeds
→ both records exist

transaction fails
→ neither record exists
```

If Redis is temporarily unavailable after the transaction commits, the OutboxEvent remains stored in PostgreSQL and can be retried later.

### Publisher Claiming

Multiple Publisher instances may poll PostgreSQL simultaneously.

Without coordination:

```text
Publisher A → sees Event X
Publisher B → sees Event X
```

Both could attempt to publish the same event.

QueueForge uses an atomic compare-and-set style `updateMany()` operation so only one Publisher successfully claims a specific OutboxEvent.

```text
Publisher A → claim → count = 1 ✅
Publisher B → claim → count = 0 ❌
```

The second Publisher skips the event.

### Lease-Based Crash Recovery

A claim stores:

```text
claimedAt
```

Claims older than **30 seconds** are considered stale.

This handles scenarios such as:

```text
Publisher claims Event X
↓
Publisher crashes 💥
↓
claim cannot be manually released
↓
30-second lease expires
↓
another Publisher can reclaim Event X
```

This prevents events from remaining permanently locked after a process crash.

### Idempotent Queue Publishing

Each BullMQ job uses the OutboxEvent ID as its deterministic BullMQ `jobId`.

```ts
jobId: event.id
```

This protects an important failure window:

```text
Publisher queue.add() succeeds ✅
↓
Publisher crashes before published=true 💥
↓
OutboxEvent is retried
↓
same BullMQ jobId is used again
```

Repeated publishing attempts therefore target the same queue-job identity instead of intentionally creating independent duplicate jobs while BullMQ retains that job record.

### At-Least-Once Processing

Background job systems must assume that a job may be delivered or executed more than once.

The Worker therefore checks whether the persisted Job is already:

```text
COMPLETED
```

and skips execution when appropriate.

However, this does **not** provide universal exactly-once guarantees for external side effects.

For example:

```text
email sent successfully ✅
↓
Worker crashes before saving COMPLETED 💥
↓
BullMQ retries
↓
email may be sent again
```

Generic SMTP delivery does not provide application-level exactly-once semantics.

QueueForge therefore follows an **at-least-once processing model** and explicitly documents this limitation.

### Retries and Backoff

QueueForge has two independent retry layers.

#### Publisher retries

These handle failures while moving an OutboxEvent from PostgreSQL to BullMQ.

Examples:

```text
Redis unavailable
invalid OutboxEvent payload
referenced Job missing
```

#### Worker retries

These handle failures while executing the actual business job.

BullMQ jobs are configured with:

```text
3 total attempts
2-second fixed backoff
```

Example:

```text
attempt 1 → failure
↓
RETRYING
↓
2 seconds
↓
attempt 2
```

### Poison Events

An OutboxEvent that can never be published must not retry forever.

Publisher failures update:

```text
attempts += 1
lastError = error message
claimedAt = null
```

After **5 failed Publisher attempts**:

```text
failed = true
```

Once an event reaches this state, the normal Publisher query excludes it:

```text
published = false
failed = true
```

The event therefore remains persisted in PostgreSQL for inspection, but it is **not retried automatically anymore**.

QueueForge currently does not expose an admin endpoint or CLI command for manually replaying failed outbox events. Operational recovery would currently require inspecting and deliberately resetting or handling the failed database record.

This is an intentional current project limitation and avoids silently retrying a permanently invalid event forever.

### Graceful Shutdown

All runtime services handle `SIGINT` and `SIGTERM`.

#### API

```text
stop accepting HTTP traffic
↓
allow active requests to finish
↓
disconnect Prisma
↓
exit
```

#### Publisher

```text
stop starting new polling cycles
↓
finish current cycle
↓
close BullMQ Queue
↓
disconnect Prisma
```

#### Worker

```text
stop accepting new BullMQ jobs
↓
allow active work to finish
↓
disconnect Prisma
↓
exit
```

This prevents dependencies from being closed while active work still needs them.

---

## Services

### API

The Express API accepts new jobs and exposes persisted job state.

| Method | Endpoint    | Description                          |
| ------ | ----------- | ------------------------------------ |
| `GET`  | `/health`   | API health check                     |
| `POST` | `/jobs`     | Create a new asynchronous job        |
| `GET`  | `/jobs/:id` | Retrieve persisted job status/result |

A successful creation returns:

```text
202 Accepted
```

because the request has been accepted for asynchronous processing but the actual work may not yet be complete.

### Publisher

The Publisher is responsible for moving durable OutboxEvents into BullMQ.

It:

* polls unpublished events every second
* processes up to 10 events per cycle
* atomically claims events
* supports multiple Publisher instances
* recovers stale claims after 30 seconds
* publishes jobs to the BullMQ `jobs` queue
* records failures and retry attempts
* stops retrying poison events after 5 failures
* marks events published only after queue insertion succeeds

### Worker

The Worker consumes BullMQ jobs and executes the correct handler.

Normal lifecycle:

```text
WAITING
↓
PROCESSING
↓
COMPLETED
```

Failure lifecycle:

```text
PROCESSING
↓
RETRYING
↓
PROCESSING
↓
...
↓
FAILED
```

Each processing attempt increments the persisted Job attempt counter.

---

## Supported Job Types

### SEND_EMAIL

Example request:

```json
{
  "type": "SEND_EMAIL",
  "payload": {
    "to": "test@example.com",
    "subject": "QueueForge test",
    "body": "Hello from QueueForge"
  }
}
```

The Worker sends email using **Nodemailer** over SMTP.

The Docker development environment uses **Mailpit**.

Successful result:

```json
{
  "messageId": "<generated-message-id>"
}
```

Mailpit UI:

```text
http://localhost:8025
```

### GENERATE_REPORT

Example request:

```json
{
  "type": "GENERATE_REPORT",
  "payload": {
    "month": "2026-09"
  }
}
```

The Worker generates a CSV report at:

```text
storage/reports/{month}.csv
```

Successful result:

```json
{
  "filePath": "/app/storage/reports/2026-09.csv"
}
```

The report uses a deterministic monthly file path, so rerunning the same month overwrites the same report file rather than creating additional copies.

---

## Job Statuses

| Status       | Meaning                                       |
| ------------ | --------------------------------------------- |
| `WAITING`    | Job was accepted and is waiting for execution |
| `PROCESSING` | Worker is currently executing the job         |
| `RETRYING`   | Previous execution failed but attempts remain |
| `COMPLETED`  | Handler completed and result was persisted    |
| `FAILED`     | Maximum execution attempts were reached       |

---

## Data Model

### Job

Important fields:

```text
id
type
payload
status
attempts
result
error
createdAt
updatedAt
```

Supported types:

```text
SEND_EMAIL
GENERATE_REPORT
```

### OutboxEvent

Important fields:

```text
id
type
payload
published
claimedAt
publishedAt
attempts
lastError
failed
createdAt
```

Current event type:

```text
JOB_CREATED
```

---

## Monorepo Structure

```text
queueforge/
├── apps/
│   ├── api/
│   │   ├── Express API
│   │   └── API tests
│   │
│   ├── publisher/
│   │   ├── Outbox polling
│   │   ├── claiming / leases
│   │   ├── BullMQ publishing
│   │   └── Publisher tests
│   │
│   └── worker/
│       ├── BullMQ Worker
│       ├── job processor
│       ├── failure handling
│       ├── handlers
│       └── Worker tests
│
├── packages/
│   ├── shared/
│   │   ├── shared TypeScript types
│   │   └── Zod schemas
│   │
│   └── database/
│       ├── Prisma schema
│       ├── migrations
│       └── shared Prisma client factory
│
├── Dockerfile
├── compose.yml
├── .env.example
├── package.json
└── tsconfig.base.json
```

---

## Tech Stack

* Node.js 22
* TypeScript
* Express 5
* PostgreSQL 18
* Prisma 7
* Redis
* BullMQ
* ioredis
* Zod
* Nodemailer
* Mailpit
* Vitest
* Supertest
* Docker
* Docker Compose
* npm workspaces

---

## Running Locally

### Prerequisites

Install:

* Node.js
* npm
* Docker
* Docker Compose

### Install Dependencies

```bash
npm ci
```

### Environment Variables

Copy:

```bash
cp .env.example .env
```

Example variables:

```env
POSTGRES_USER=queueforge
POSTGRES_PASSWORD=change-me
POSTGRES_DB=queueforge

DATABASE_URL=postgresql://queueforge:change-me@postgres:5432/queueforge?schema=public

REDIS_HOST=redis
REDIS_PORT=6379

SMTP_HOST=mailpit
SMTP_PORT=1025

PORT=3000
```

Inside the Compose network, services communicate using Docker DNS names:

```text
postgres:5432
redis:6379
mailpit:1025
```

From the host machine PostgreSQL is exposed at:

```text
localhost:5433
```

---

## Database Migrations

Database migrations are currently run separately rather than automatically during Compose startup.

First start the infrastructure:

```bash
docker compose up -d postgres redis mailpit
```

Then run Prisma migrations from:

```text
packages/database
```

using the PostgreSQL port exposed to the host:

```bash
cd packages/database

DATABASE_URL="postgresql://queueforge:<password>@localhost:5433/queueforge?schema=public" \
npx prisma migrate dev

npx prisma generate

cd ../..
```

Replace `<password>` with the password configured in your `.env`.

---

## Start the Complete Stack

```bash
docker compose up --build
```

This starts:

```text
PostgreSQL
Redis
Mailpit
API
Publisher
Worker
```

API:

```text
http://localhost:3000
```

Mailpit:

```text
http://localhost:8025
```

---

## API Examples

### Create Email Job

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "SEND_EMAIL",
    "payload": {
      "to": "test@example.com",
      "subject": "QueueForge",
      "body": "Hello from the background worker"
    }
  }'
```

Example response:

```json
{
  "message": "Job accepted",
  "jobId": "<uuid>",
  "status": "WAITING",
  "statusUrl": "/jobs/<uuid>"
}
```

### Create Report Job

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "GENERATE_REPORT",
    "payload": {
      "month": "2026-09"
    }
  }'
```

### Check Job Status

```bash
curl http://localhost:3000/jobs/<jobId>
```

A completed job contains its persisted result.

---

## Testing

QueueForge currently has **15 automated tests** across the API, Publisher, and Worker.

Run all workspace tests:

```bash
npm test --workspaces --if-present
```

The suite covers:

* API health check
* invalid job validation
* atomic Job + OutboxEvent creation
* job lookup success
* job lookup 404
* lost Publisher claim protection
* successful OutboxEvent publishing
* retryable Publisher failures
* terminal poison-event handling
* completed-job replay protection
* successful SEND_EMAIL execution
* successful GENERATE_REPORT execution
* handler failure behavior
* Worker `RETRYING` state
* Worker terminal `FAILED` state

The automated suite mainly uses mocked infrastructure dependencies.

The complete:

```text
API
→ PostgreSQL
→ Publisher
→ Redis / BullMQ
→ Worker
```

flow has also been manually smoke-tested with both supported job types.

---

## Type Checking

```bash
npx tsc --noEmit -p apps/api/tsconfig.json
npx tsc --noEmit -p apps/publisher/tsconfig.json
npx tsc --noEmit -p apps/worker/tsconfig.json
```

---

## Current Limitations

QueueForge is a portfolio-scale distributed job-processing system rather than a production hosting configuration.

Current limitations include:

* database migrations are not automatically executed during Compose startup
* Docker Compose currently runs development commands using `tsx watch`
* SMTP side effects have at-least-once rather than exactly-once guarantees
* failed poison OutboxEvents remain persisted with `failed = true`; there is currently no admin endpoint or CLI for manual replay
* automated tests mainly mock PostgreSQL, Redis, and SMTP instead of running full infrastructure integration tests
* outbox polling currently has no dedicated database indexes
* `OutboxEvent.payload.jobId` is stored inside JSON rather than as a relational foreign key

These limitations are documented intentionally rather than presenting stronger guarantees than the implementation actually provides.

---

## What This Project Demonstrates

QueueForge demonstrates practical backend and distributed-systems concepts including:

* asynchronous HTTP processing with `202 Accepted`
* durable job state
* background workers
* Redis-backed queues
* BullMQ retries and backoff
* the **dual-write problem**
* the **Transactional Outbox pattern**
* **idempotent publishing**
* **at-least-once processing**
* **multi-publisher concurrency**
* **atomic claiming**
* **lease-based crash recovery**
* **poison-event handling**
* persisted job lifecycle transitions
* graceful shutdown
* runtime validation with Zod
* Dockerized multi-service architecture
* automated testing of both happy paths and failure paths

## License

ISC
