---
libs:
  "@aws-sdk/client-s3":
    version: "^3.1079.0"
    context7_id: unavailable-in-this-codex-session
    source: official-docs-fallback
    fetched_at: "2026-07-05T09:43:00-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1079.0"
    context7_id: unavailable-in-this-codex-session
    source: official-docs-fallback
    fetched_at: "2026-07-05T09:43:00-03:00"
  "@nestjs/bullmq":
    version: "^11.0.4"
    context7_id: unavailable-in-this-codex-session
    source: official-docs-fallback
    fetched_at: "2026-07-05T09:43:00-03:00"
  bullmq:
    version: "^5.79.2"
    context7_id: unavailable-in-this-codex-session
    source: official-docs-fallback
    fetched_at: "2026-07-05T09:43:00-03:00"
  ffmpeg:
    version: "system package in worker image"
    context7_id: not-applicable
    source: official-docs-fallback
    fetched_at: "2026-07-05T09:43:00-03:00"
  "@nestjs/common":
    version: "^11.0.1"
    context7_id: unavailable-in-this-codex-session
    source: official-docs-fallback
    fetched_at: "2026-07-05T09:43:00-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-05T09:41:20-03:00"
  docs/phases/phase-03-videos/validation.md: "2026-07-05T09:42:27-03:00"
---

# phase-03-videos - Library References

Context7 MCP lookup was required by project instructions, but the tool is not exposed in this Codex session after tool discovery. This file therefore uses official primary documentation as a fallback and records that limitation explicitly.

## AWS SDK v3 S3 and Multipart Upload

**Sources:**

- AWS S3 User Guide - Multipart upload overview: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html>
- AWS SDK for JavaScript v3 - S3 code examples: <https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html>

**Package versions planned:** `@aws-sdk/client-s3@^3.1079.0`, `@aws-sdk/s3-request-presigner@^3.1079.0`

**Implementation contracts:**

- Configure one `S3Client` provider with endpoint, region, credentials, and `forcePathStyle: true` for MinIO compatibility.
- Use `CreateMultipartUploadCommand` when the authenticated user starts an upload; persist the returned `UploadId` and the object key on the draft video.
- Use `UploadPartCommand` with `getSignedUrl()` to create presigned URLs for requested part numbers. The API signs storage operations; it does not receive the file body.
- Use `CompleteMultipartUploadCommand` with the client-submitted `{ PartNumber, ETag }` list. Sort parts by number before completing.
- Use `AbortMultipartUploadCommand` for cancelled/failed draft uploads so incomplete storage parts are not left behind.
- Use `HeadObjectCommand` before streaming/download to retrieve object size and content type.
- Use `GetObjectCommand` with `Range: bytes=start-end` for video streaming and without `Range` for full download.
- Use `PutObjectCommand` for generated thumbnail uploads from the worker.

**Multipart constraints for this phase:**

- Part numbers are 1 through 10000.
- Default part size is 100 MiB; it supports 10GB uploads with roughly 100 parts and stays far below the part limit.
- Minimum part size is 5 MiB except the final part. The service validates `size_bytes <= 10GB` and calculates part count server-side.
- The API persists draft metadata before returning upload instructions.

## BullMQ with NestJS

**Sources:**

- BullMQ NestJS guide: <https://docs.bullmq.io/guide/nestjs>
- NestJS Queues technique docs: <https://docs.nestjs.com/techniques/queues>

**Package versions planned:** `@nestjs/bullmq@^11.0.4`, `bullmq@^5.79.2`

**Implementation contracts:**

- Configure queue connection with `BullModule.forRoot({ connection: { host: queue.host, port: queue.port } })`.
- In Docker containers, `QUEUE_REDIS_HOST` must be `redis`, never `localhost`.
- Register queue name `video-processing` with `BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE })`.
- API-side producer injects `@InjectQueue(VIDEO_PROCESSING_QUEUE)` and calls `queue.add('process-video', payload, { jobId, attempts, backoff })`.
- Worker-side consumer uses `@Processor(VIDEO_PROCESSING_QUEUE)` in a module imported only by `src/worker.ts`.
- Processor extends BullMQ/Nest worker host APIs and updates the video row to `ready` or `error`.
- Job payload is deliberately small: `{ videoId, channelId, originalFileKey }`. The worker reads all large bytes from object storage.

## FFmpeg and ffprobe

**Sources:**

- FFprobe documentation: <https://ffmpeg.org/ffprobe.html>
- FFmpeg documentation: <https://ffmpeg.org/ffmpeg.html>

**Implementation contracts:**

- Install the system `ffmpeg` package in the Docker image used by `video-worker`.
- Use `ffprobe` to extract metadata as JSON:

```bash
ffprobe -v error -print_format json -show_format -show_streams input-video
```

- Parse `format.duration` as the canonical duration in seconds when present.
- Store raw useful metadata in `videos.metadata` as JSONB, with only serializable fields.
- Use `ffmpeg` to extract a thumbnail frame:

```bash
ffmpeg -y -ss 00:00:01 -i input-video -frames:v 1 -q:v 2 thumbnail.jpg
```

- Wrap process execution with timeout, stderr capture, and temporary-file cleanup in `finally`.
- Worker failures update the video row to `error` with a machine-readable error code and a short message.

## NestJS Streaming and HTTP Range

**Sources:**

- NestJS streaming files: <https://docs.nestjs.com/techniques/streaming-files>
- MDN HTTP Range requests: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests>

**Installed NestJS package:** `@nestjs/common@^11.0.1`

**Implementation contracts:**

- Streaming endpoint supports:
  - `GET /videos/:publicId/stream` with `Range: bytes=start-end` returning `206 Partial Content`.
  - `GET /videos/:publicId/stream` without `Range` returning `200 OK` with a full object stream.
  - Invalid or unsatisfiable ranges returning `416 Range Not Satisfiable` with `Content-Range: bytes */<size>`.
- Response headers for partial content:
  - `Accept-Ranges: bytes`
  - `Content-Range: bytes <start>-<end>/<size>`
  - `Content-Length: <end-start+1>`
  - `Content-Type: <stored mime type>`
- Only single byte ranges are supported in Phase 03. Multi-range requests are rejected as unsatisfiable to keep the first implementation simple and testable.
- Use Nest response passthrough or `StreamableFile` to stream Node readable bodies from S3 without buffering the entire video in memory.
- Download endpoint uses the same storage stream but sets `Content-Disposition: attachment; filename="<original_file_name>"`.

## TypeORM/PostgreSQL

**Sources:**

- TypeORM Entities: <https://typeorm.io/entities>
- TypeORM Migrations: <https://typeorm.io/migrations>
- TypeORM Transactions: <https://typeorm.io/transactions>

**Installed package:** `typeorm@^0.3.28`

**Implementation contracts:**

- `videos` entity must use explicit table name, explicit column types, timestamps, and indexes.
- Migration must be reversible with a complete `down()` method.
- Use a unique index for `public_id` and indexes for `channel_id`, `status`, and object-key lookup where needed.
- Use `DataSource.transaction()` when changing upload status and queue publication state in one flow, or document the compensating strategy if queue publication fails after DB commit.
