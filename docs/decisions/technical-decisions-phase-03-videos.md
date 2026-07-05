---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-07-05
scope_description: "Backend foundation for video upload and processing: S3-compatible object storage, 10GB multipart uploads, background queue, dedicated video worker, FFmpeg metadata/thumbnail extraction, unique public video URLs, Range streaming, and owner download."
---

# Technical Decisions - Phase 03: Upload e Processamento de Videos

_Subprojects in scope:_

- `nestjs-project/` - backend API, object-storage integration, queue producer, video domain, database schema, streaming/download endpoints, and dedicated worker bootstrap.
- `next-frontend/` - video UI is explicitly out of scope for this phase. The backend contracts are designed for a future frontend, but no `next-frontend/` screen or BFF route is implemented here.

---

## TD-01: Object Storage Provider and Client

**Scope:** Backend

**Capability:** Servico de armazenamento de arquivos (videos e thumbnails)

**Context:** Video binaries and thumbnails must not be stored in PostgreSQL or on the API container filesystem. The architecture diagram calls for S3/MinIO object storage, and local development must run entirely in Docker Compose.

**Options:**

### Option A: MinIO with AWS SDK for JavaScript v3
- Run MinIO in Docker Compose and access it through the S3-compatible AWS SDK commands.
- **Pros:** Matches the architecture diagram, supports multipart upload and Range reads, works locally without cloud credentials, keeps production migration path open to AWS S3 or another compatible provider, and uses the modular AWS SDK packages.
- **Cons:** Requires bucket bootstrap and more configuration than local disk.

### Option B: MinIO JavaScript SDK
- Use MinIO's own JavaScript client.
- **Pros:** Native MinIO docs and simple local API.
- **Cons:** Couples the application to MinIO-specific APIs even though the architecture only requires S3 compatibility.

### Option C: Local filesystem volume
- Store videos in a Docker volume mounted into the API/worker containers.
- **Pros:** Lowest setup cost.
- **Cons:** Does not match the architecture, makes future S3 migration harder, and makes Range streaming/download semantics less representative.

**Recommendation:** **Option A (MinIO + AWS SDK v3)** - It satisfies the S3-compatible storage requirement while keeping local development cloud-free.

**Decision:** A (MinIO with AWS SDK for JavaScript v3)

**Libraries:** `@aws-sdk/client-s3@^3.1079.0`, `@aws-sdk/s3-request-presigner@^3.1079.0`

---

## TD-02: 10GB Upload Protocol

**Scope:** Cross-layer

**Capability:** Upload de videos com suporte a arquivos de ate 10GB sem impacto na performance; Pre-cadastro automatico do video como rascunho ao iniciar o upload

**Context:** A 10GB upload cannot flow through the NestJS API request body without blocking workers, exhausting memory, or tying API throughput to client upload duration. The API must create the draft record and coordinate storage, while the client uploads directly to object storage.

**Options:**

### Option A: API receives multipart/form-data and streams to storage
- The browser posts the file to NestJS; NestJS streams to object storage.
- **Pros:** Simple client contract.
- **Cons:** Long-lived HTTP requests on the API, higher memory/backpressure risk, and contradicts the "sem impacto na performance" requirement for 10GB files.

### Option B: Presigned S3 multipart upload
- API creates a draft video, starts an S3 multipart upload, returns an upload id and presigned part URLs, then completes the upload after the client submits ETags.
- **Pros:** API never receives the large payload, upload parts can retry independently, supports 10GB comfortably, and draft creation happens before bytes are sent.
- **Cons:** More endpoints and client coordination.

### Option C: Single presigned PUT URL
- API creates a draft video and returns one presigned PUT URL.
- **Pros:** Simple direct-to-storage upload.
- **Cons:** Poor fit for 10GB reliability because a failed upload restarts from zero.

**Recommendation:** **Option B (Presigned S3 multipart upload)** - It is the only option that clearly satisfies the 10GB and non-blocking requirements.

**Decision:** B (Presigned S3 multipart upload)

**Libraries:** `@aws-sdk/client-s3@^3.1079.0`, `@aws-sdk/s3-request-presigner@^3.1079.0`

---

## TD-03: Background Queue Technology

**Scope:** Backend

**Capability:** Servico de processamento em segundo plano (filas); Processamento automatico do video apos upload

**Context:** Upload completion must enqueue video processing outside the API request cycle. The project needs a real broker that works in Docker Compose and has first-class NestJS support.

**Options:**

### Option A: BullMQ with Redis
- Use `@nestjs/bullmq` producers in the API and a Redis-backed BullMQ worker.
- **Pros:** Official NestJS integration, durable queue state, retry/backoff support, separate worker containers, and broad community usage.
- **Cons:** Adds Redis to local infrastructure.

### Option B: PostgreSQL polling table
- Insert processing rows in PostgreSQL and run a polling worker.
- **Pros:** Avoids Redis.
- **Cons:** Reimplements queue semantics, retries, delays, concurrency, and job state handling.

### Option C: In-memory queue
- Keep jobs in API process memory.
- **Pros:** Minimal code.
- **Cons:** Not durable, not multi-container, and fails the "real queue/worker" requirement.

**Recommendation:** **Option A (BullMQ with Redis)** - It is the smallest real queue that aligns with NestJS and the phase requirement.

**Decision:** A (BullMQ with Redis)

**Libraries:** `@nestjs/bullmq@^11.0.4`, `bullmq@^5.79.2`

---

## TD-04: Worker Execution Model

**Scope:** Backend

**Capability:** Processamento automatico do video apos upload; Geracao automatica de thumbnail a partir de um frame do video

**Context:** Processing can run FFmpeg/ffprobe and must not execute in the HTTP API container. The worker must be independently scalable and observable.

**Options:**

### Option A: Dedicated NestJS worker bootstrap and Docker Compose service
- Add a separate `src/worker.ts` entrypoint that imports only worker modules and run it in a `video-worker` service.
- **Pros:** Reuses NestJS DI/config, keeps queue processors out of the API process, and allows independent scaling.
- **Cons:** Requires a second build/start command and Docker Compose service.

### Option B: Processor registered inside the API app
- Register BullMQ processors in the same `AppModule`.
- **Pros:** Fewer files and containers.
- **Cons:** API instances process videos and FFmpeg competes with HTTP requests.

### Option C: Ad hoc Node script
- Write a standalone script with manual env parsing.
- **Pros:** Small initial surface.
- **Cons:** Duplicates config/DI patterns and drifts from NestJS module conventions.

**Recommendation:** **Option A (Dedicated NestJS worker service)** - It satisfies the separation requirement while preserving project conventions.

**Decision:** A (Dedicated NestJS worker bootstrap and Compose service)

**Libraries:** `@nestjs/bullmq@^11.0.4`, `bullmq@^5.79.2`

---

## TD-05: Video Metadata and Thumbnail Extraction

**Scope:** Backend

**Capability:** Processamento automatico do video apos upload (extracao de duracao e metadados); Geracao automatica de thumbnail a partir de um frame do video

**Context:** The worker must inspect uploaded media and generate a thumbnail. The core engine should be FFmpeg/ffprobe, but the project must decide whether to wrap the CLI with an npm abstraction.

**Options:**

### Option A: Call `ffprobe` and `ffmpeg` CLI from the worker
- Install FFmpeg in the worker/API Docker image and invoke the binaries through Node child processes.
- **Pros:** Uses the canonical media tooling directly, avoids wrapper dependency drift, supports JSON ffprobe output, and keeps command arguments explicit.
- **Cons:** Requires careful process timeout/error handling and temporary file cleanup.

### Option B: `fluent-ffmpeg`
- Use an npm wrapper around FFmpeg.
- **Pros:** Friendly JavaScript API.
- **Cons:** Adds an abstraction over CLI options and can lag behind FFmpeg behavior.

### Option C: External media processing service
- Delegate processing to a managed service.
- **Pros:** Production-grade scaling potential.
- **Cons:** Overkill for this local Docker/academic phase and adds vendor dependence.

**Recommendation:** **Option A (Direct FFmpeg/ffprobe CLI)** - It is explicit, portable, and sufficient for the required metadata/thumbnail workflow.

**Decision:** A (Direct FFmpeg/ffprobe CLI)

**Libraries:** System package `ffmpeg` in the worker image; no npm wrapper.

---

## TD-06: Unique Public Video URL Strategy

**Scope:** Cross-layer

**Capability:** URL unica por video, sem conflito com outros videos

**Context:** Videos need conflict-free public URLs before title editing/publication features exist. Title-derived slugs create collision and rename questions that are out of scope for Phase 03.

**Options:**

### Option A: Title-based slug with suffix collision handling
- Generate slugs from video titles.
- **Pros:** Human-readable.
- **Cons:** Title updates, profanity, Unicode normalization, and collisions become product concerns before Phase 04.

### Option B: Random public id stored with a unique database constraint
- Generate a URL-safe random id using Node `crypto.randomBytes`, retry on unique collision, and expose it as the public URL token.
- **Pros:** Collision-resistant, stable, independent of title, no new dependency, and easy to enforce with a unique index.
- **Cons:** Less human-readable than title slugs.

### Option C: Use database UUID as public id
- Reuse `videos.id` in URLs.
- **Pros:** No extra column.
- **Cons:** Couples public URLs to internal primary keys and makes future URL strategy changes harder.

**Recommendation:** **Option B (Random public id + unique constraint)** - It is stable, private enough, and matches the current phase scope.

**Decision:** B (Random public id stored with unique constraint)

**Libraries:** Node.js `crypto`

---

## TD-07: Streaming and Download Strategy

**Scope:** Cross-layer

**Capability:** Reproducao via streaming (sem necessidade de download completo); Download do video pelo usuario

**Context:** The API must support video playback without requiring clients to download the full object first. Browsers use HTTP Range requests for media scrubbing and progressive playback.

**Options:**

### Option A: API proxies S3 Range reads and returns `206 Partial Content`
- Parse the HTTP `Range` header, request the matching byte range from object storage, and stream the object body to the response with `Accept-Ranges`, `Content-Range`, and `Content-Length`.
- **Pros:** Keeps storage private, supports browser streaming, centralizes auth/status checks, and works with MinIO/S3.
- **Cons:** API bandwidth is used for playback.

### Option B: Presigned GET URL for playback
- Return a temporary object-storage URL to the client.
- **Pros:** Reduces API bandwidth.
- **Cons:** Harder to enforce app-level authorization/status checks for every request and exposes object storage URLs directly.

### Option C: Full-file download only
- Serve `200 OK` without Range support.
- **Pros:** Simple.
- **Cons:** Fails the streaming requirement.

**Recommendation:** **Option A (API Range proxy)** - It is the safest fit for the current auth/status model and explicitly satisfies `206` streaming.

**Decision:** A (API proxies S3 Range reads and owner download streams)

**Libraries:** `@aws-sdk/client-s3@^3.1079.0`, NestJS `StreamableFile`

---

## TD-08: Video Status and Failure Handling

**Scope:** Backend

**Capability:** Processamento automatico do video apos upload; Geracao automatica de thumbnail; reproducao/download somente de videos prontos

**Context:** Users and tests must be able to observe processing state and failures. Queue failures cannot remain only in BullMQ because the video record is the domain source of truth.

**Options:**

### Option A: Persist lifecycle status and processing errors on `videos`
- Use status values `draft`, `processing`, `ready`, and `error`; store duration, metadata, thumbnail key, processed timestamp, and structured error data.
- **Pros:** Simple API queries, durable user-visible state, and clear acceptance tests.
- **Cons:** The video row grows with processing fields.

### Option B: Separate `video_processing_jobs` table
- Keep video metadata and job state in separate tables.
- **Pros:** Cleaner audit history if many attempts are retained.
- **Cons:** More schema and service complexity than Phase 03 needs.

### Option C: Trust BullMQ job state only
- Query queue state when needed.
- **Pros:** No extra DB fields.
- **Cons:** Queue state is operational, not domain state, and is not enough for public endpoints.

**Recommendation:** **Option A (Persist lifecycle on `videos`)** - It is the direct domain model needed for Phase 03 and later phases can add a job-history table if required.

**Decision:** A (Persist lifecycle status and errors on `videos`)

**Libraries:** TypeORM/PostgreSQL already in project

---

## Decisions Summary

| ID | Scope | Decision | Choice | Libraries |
|----|-------|----------|--------|-----------|
| TD-01 | Backend | Object Storage Provider and Client | MinIO + AWS SDK v3 | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` |
| TD-02 | Cross-layer | 10GB Upload Protocol | Presigned S3 multipart upload | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` |
| TD-03 | Backend | Background Queue Technology | BullMQ with Redis | `@nestjs/bullmq`, `bullmq` |
| TD-04 | Backend | Worker Execution Model | Dedicated NestJS worker service | `@nestjs/bullmq`, `bullmq` |
| TD-05 | Backend | Metadata and Thumbnail Extraction | Direct FFmpeg/ffprobe CLI | `ffmpeg` system package |
| TD-06 | Cross-layer | Unique Public Video URL Strategy | Random public id + unique DB constraint | Node.js `crypto` |
| TD-07 | Cross-layer | Streaming and Download Strategy | API Range proxy + download stream | `@aws-sdk/client-s3`, NestJS `StreamableFile` |
| TD-08 | Backend | Video Status and Failure Handling | Persist lifecycle on `videos` | TypeORM/PostgreSQL |

---

## New Dependencies

| Package / service | Version | Purpose |
|-------------------|---------|---------|
| `@aws-sdk/client-s3` | `^3.1079.0` | S3-compatible object operations, multipart upload, Range reads |
| `@aws-sdk/s3-request-presigner` | `^3.1079.0` | Presigned URLs for multipart upload parts |
| `@nestjs/bullmq` | `^11.0.4` | NestJS queue module and processor integration |
| `bullmq` | `^5.79.2` | Redis-backed queue implementation |
| Redis service | `redis:7-alpine` | Queue broker for BullMQ |
| MinIO service | `minio/minio` image | Local S3-compatible object storage |
| FFmpeg system package | Docker image package | `ffprobe` metadata extraction and `ffmpeg` thumbnail generation |
