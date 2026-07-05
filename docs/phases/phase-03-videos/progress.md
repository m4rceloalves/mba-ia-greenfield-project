# phase-03-videos - Progress

**Status:** completed
**SIs:** 8/8 completed
**Current SI:** none

### SI-03.1 - Dependencies, Configuration Namespaces, and Docker Compose Services
- **Status:** completed
- **Tests:** 15/15 passing inside container (`docker --context desktop-linux compose run --rm --no-deps nestjs-api npm test -- --runInBand src/config/storage.config.spec.ts src/config/queue.config.spec.ts src/config/video.config.spec.ts src/config/env.validation.integration-spec.ts`)
- **Observations:** `docker --context desktop-linux compose config --quiet` passed. `video-worker` is included in default Compose services (no profile required). `docker --context desktop-linux compose build nestjs-api video-worker` built the image successfully with `ffmpeg` and `npm ci`. Compose now uses a named `node-modules` volume so `docker compose up -d` works from a fresh clone even with the source bind mount. A temporary API smoke container returned `Hello World!` from inside the container using the Compose command.

### SI-03.2 - Video Entity, Migration, and Module Skeleton
- **Status:** completed
- **Tests:** 9/9 passing inside container (`docker --context desktop-linux compose run --rm --no-deps nestjs-api npm test -- --runInBand src/videos/entities/video.entity.integration-spec.ts src/videos/videos.module.spec.ts src/database/migrations.integration-spec.ts`)
- **Observations:** Initial migration test failed because an old `verification_tokens_type_enum` enum was left in the shared DB; updated the migration test setup to drop managed enums sequentially before running migrations. Entity tests verify `draft` default, nullable processing fields, bigint transformer, unique `public_id`, channel relation, and channel-delete cascade.

### SI-03.3 - S3 Storage Adapter and Multipart Upload Service
- **Status:** completed
- **Tests:** 16/16 passing inside container (`video-storage.service.spec.ts`, `videos.module.spec.ts`, `video-storage.service.integration-spec.ts`)
- **Observations:** `minio` and `minio-init` ran successfully; buckets `streamtube-videos` and `streamtube-thumbnails` were created. Integration test completed a real multipart upload through a presigned part URL and verified object Range read from MinIO.

### SI-03.4 - Upload Initiation, Part Signing, Completion, Abort, and Queue Publication API
- **Status:** completed
- **Tests:** 21/21 passing inside container (`video-processing-queue.service.spec.ts`, `videos.service.spec.ts`, `videos.module.spec.ts`, `test/videos-upload.e2e-spec.ts`)
- **Observations:** E2E exercises real auth, DB, MinIO multipart upload through a presigned part URL, Redis/BullMQ job publication, owner-only access, abort, 413 size handling, and 415 MIME handling. Part signing is validated against the persisted `part_count` before presigning. BullMQ v5 rejects `:` in custom `jobId`; changed idempotent format from `process-video:{videoId}` to `process-video-{videoId}` and updated the plan.

### SI-03.5 - Dedicated Worker and Video Processing Pipeline
- **Status:** completed
- **Tests:** 7/7 passing inside container (`video-media-probe.service.spec.ts`, `video-thumbnail.service.spec.ts`, `video-processing.processor.spec.ts`, `video-processing.processor.integration-spec.ts`)
- **Observations:** Added dedicated `src/worker.ts` bootstrap and `VideoWorkerModule` so the API does not register the processor. Integration tests generate a tiny video with real FFmpeg, upload it to MinIO, run the processor directly, and also start `VideoWorkerModule` to consume a real Redis/BullMQ job and persist `ready` status/duration/metadata/thumbnail.

### SI-03.6 - Public Metadata and Owner Status API
- **Status:** completed
- **Tests:** 17/17 passing inside container (`videos.service.spec.ts`, `test/videos-metadata.e2e-spec.ts`)
- **Observations:** Public `GET /videos/:publicId` returns only `ready` videos and hides draft/processing/error as `VIDEO_NOT_FOUND`; owner status exposes persisted processing error fields and thumbnail URL without exposing storage keys.

### SI-03.7 - Streaming Endpoint with HTTP Range Support
- **Status:** completed
- **Tests:** 16/16 passing inside container (`docker --context desktop-linux compose run --rm --no-deps nestjs-api npm test -- --runInBand src/videos/range.util.spec.ts src/videos/videos-streaming.service.spec.ts`; `docker --context desktop-linux compose run --rm nestjs-api npm run test:e2e -- videos-streaming.e2e-spec.ts --runInBand`)
- **Observations:** Public `GET /videos/:publicId/stream` supports full streams and single HTTP byte ranges through S3 `HeadObject` + ranged `GetObject`. Invalid/multi/unsatisfiable ranges return `416 VIDEO_RANGE_NOT_SATISFIABLE` with `Content-Range: bytes */<size>`. E2E verifies real MinIO object reads and partial response bodies.

### SI-03.8 - Download Endpoint, OpenAPI, Documentation, and Final Quality Gate
- **Status:** completed
- **Tests:** Final gates passing inside container:
  - `docker --context desktop-linux compose config --quiet` — passing
  - `docker --context desktop-linux compose build nestjs-api video-worker` — passing
  - Temporary API smoke container using the Compose command returned `Hello World!` internally on `http://localhost:3000`
  - `docker --context desktop-linux compose run --rm nestjs-api npm test -- --runInBand` — 38 suites / 220 tests passing
  - `docker --context desktop-linux compose run --rm nestjs-api npm run test:integration` — 14 suites / 96 tests passing
  - `docker --context desktop-linux compose run --rm nestjs-api npm run test:e2e -- --runInBand` — 7 suites / 68 tests passing
  - `docker --context desktop-linux compose run --rm --no-deps nestjs-api npx tsc --noEmit` — passing
  - `docker --context desktop-linux compose run --rm --no-deps nestjs-api npm run lint` — passing with existing `no-unsafe-argument` warnings in older tests
- **Observations:** Added public `GET /videos/:publicId/download` attachment streaming for ready videos and public `GET /videos/:publicId/thumbnail` to back the metadata `thumbnailUrl`. Regenerated `openapi.json`; public video metadata/thumbnail/stream/download operations have no bearer security requirement while upload/status operations keep `access-token`. Updated `AGENTS.md`, root `CLAUDE.md`, and `nestjs-project/CLAUDE.md` with real Phase 03 services, endpoints, storage conventions, queue/job names, and Docker service-name env vars. ESLint now has a test-file override for common Jest/Supertest mock patterns while keeping production type-safety errors active.

### Adversarial Review Fixes
- **Status:** completed
- **Reviewer:** Multi-agent adversarial review found OpenAPI public-security drift, missing thumbnail endpoint, storage key exposure in owner status, part signing beyond `part_count`, `video-worker` profile risk, `DB_HOST=localhost` defaults, fresh-clone Compose startup risk, and missing evidence that the worker consumes Redis/BullMQ jobs.
- **Resolution:** Fixed all findings; added tests for public OpenAPI security, thumbnail streaming, part-count validation, owner `thumbnailUrl`, Compose/DB defaults, and real worker-module queue consumption. Rebuilt Docker image with `npm ci`, verified API startup through Compose command, and reran final gates after the fixes.
