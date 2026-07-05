---
kind: phase
name: phase-03-videos
sources_mtime:
  especificacao-streamtube-fase-03.md: "2026-07-05T09:07:35-03:00"
  docs/project-plan.md: "2026-07-05T08:53:52-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-05T09:41:20-03:00"
  docs/decisions/technical-decisions-phase-02-auth.md: "2026-07-05T08:53:52-03:00"
  docs/decisions/technical-decisions-phase-01-configuracao-base.md: "2026-07-05T08:53:52-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-07-05T08:53:52-03:00"
---

# phase-03-videos - Context

## Scope

**Phase name:** Fase 03 - Upload e Processamento de Videos

**Capabilities**

- Servico de armazenamento de arquivos (videos e thumbnails)
- Servico de processamento em segundo plano (filas)
- Upload de videos com suporte a arquivos de ate 10GB sem impacto na performance
- Pre-cadastro automatico do video como rascunho ao iniciar o upload
- Processamento automatico do video apos upload (extracao de duracao e metadados)
- Geracao automatica de thumbnail a partir de um frame do video
- URL unica por video, sem conflito com outros videos
- Reproducao via streaming (sem necessidade de download completo)
- Download do video pelo usuario

**Out of scope:** UI de videos no `next-frontend/`, publicacao/visibilidade editorial, comentarios, likes, subscriptions, transcodificacao adaptativa/HLS, moderacao, busca, analytics, CDN, processamento distribuido avancado.

**Deliverables:** upload funcional ate 10GB por multipart direto no storage, pre-cadastro como rascunho, processamento automatico com worker real, thumbnail, URL publica unica, streaming com Range e download.

**Affected subprojects:** `nestjs-project/`

**Deferred subprojects:** `next-frontend/` - video UI is explicitly outside Phase 03. The backend API contract is documented for later consumption.

**Sequencing notes:** Depends on Fase 01 (config/DB foundation) and Fase 02 (auth, users, channels, validation/error contract). Phase 02 progress is complete.

**Repository note:** The repository currently has `main` and `origin/main` only; no local or remote `dev` branch exists. Work is isolated on `feature/streamtube-fase-03` to avoid direct changes on `main`.

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | technical-decisions-phase-03-videos.md | Backend | Object Storage Provider and Client | decided | A (MinIO with AWS SDK v3) | `@aws-sdk/client-s3@^3.1079.0`, `@aws-sdk/s3-request-presigner@^3.1079.0` |
| phase-03-videos/TD-02 | technical-decisions-phase-03-videos.md | Cross-layer | 10GB Upload Protocol | decided | B (Presigned S3 multipart upload) | `@aws-sdk/client-s3@^3.1079.0`, `@aws-sdk/s3-request-presigner@^3.1079.0` |
| phase-03-videos/TD-03 | technical-decisions-phase-03-videos.md | Backend | Background Queue Technology | decided | A (BullMQ with Redis) | `@nestjs/bullmq@^11.0.4`, `bullmq@^5.79.2` |
| phase-03-videos/TD-04 | technical-decisions-phase-03-videos.md | Backend | Worker Execution Model | decided | A (Dedicated NestJS worker service) | `@nestjs/bullmq@^11.0.4`, `bullmq@^5.79.2` |
| phase-03-videos/TD-05 | technical-decisions-phase-03-videos.md | Backend | Video Metadata and Thumbnail Extraction | decided | A (Direct FFmpeg/ffprobe CLI) | System `ffmpeg` package |
| phase-03-videos/TD-06 | technical-decisions-phase-03-videos.md | Cross-layer | Unique Public Video URL Strategy | decided | B (Random public id + unique constraint) | Node.js `crypto` |
| phase-03-videos/TD-07 | technical-decisions-phase-03-videos.md | Cross-layer | Streaming and Download Strategy | decided | A (API Range proxy + download stream) | `@aws-sdk/client-s3@^3.1079.0`, NestJS `StreamableFile` |
| phase-03-videos/TD-08 | technical-decisions-phase-03-videos.md | Backend | Video Status and Failure Handling | decided | A (Persist lifecycle on `videos`) | TypeORM/PostgreSQL |

_Source files:_

- `docs/decisions/technical-decisions-phase-03-videos.md`
- `docs/decisions/technical-decisions-phase-02-auth.md`
- `docs/decisions/technical-decisions-phase-01-configuracao-base.md`
- `docs/decisions/technical-decisions-openapi-docs-nestjs.md`

## Capability Coverage

| Capability | Covered by |
|------------|------------|
| Servico de armazenamento de arquivos (videos e thumbnails) | phase-03-videos/TD-01, phase-03-videos/TD-05 |
| Servico de processamento em segundo plano (filas) | phase-03-videos/TD-03, phase-03-videos/TD-04 |
| Upload de videos com suporte a arquivos de ate 10GB sem impacto na performance | phase-03-videos/TD-02, phase-03-videos/TD-01 |
| Pre-cadastro automatico do video como rascunho ao iniciar o upload | phase-03-videos/TD-02, phase-03-videos/TD-08 |
| Processamento automatico do video apos upload (extracao de duracao e metadados) | phase-03-videos/TD-03, phase-03-videos/TD-04, phase-03-videos/TD-05, phase-03-videos/TD-08 |
| Geracao automatica de thumbnail a partir de um frame do video | phase-03-videos/TD-05, phase-03-videos/TD-01 |
| URL unica por video, sem conflito com outros videos | phase-03-videos/TD-06 |
| Reproducao via streaming (sem necessidade de download completo) | phase-03-videos/TD-07 |
| Download do video pelo usuario | phase-03-videos/TD-07 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** Option A (MinIO + AWS SDK v3) - satisfies the S3-compatible storage requirement while keeping local development cloud-free.

**Libraries:** `@aws-sdk/client-s3@^3.1079.0`, `@aws-sdk/s3-request-presigner@^3.1079.0`

### phase-03-videos/TD-02

**Recommendation:** Option B (Presigned S3 multipart upload) - the API creates the draft and signs storage operations, but the 10GB payload goes directly from client to object storage.

**Libraries:** `@aws-sdk/client-s3@^3.1079.0`, `@aws-sdk/s3-request-presigner@^3.1079.0`

### phase-03-videos/TD-03

**Recommendation:** Option A (BullMQ with Redis) - provides a real queue, retries, and separate workers with first-class NestJS integration.

**Libraries:** `@nestjs/bullmq@^11.0.4`, `bullmq@^5.79.2`

### phase-03-videos/TD-04

**Recommendation:** Option A (Dedicated NestJS worker service) - keeps FFmpeg processing out of the API process and reuses NestJS DI/config.

**Libraries:** `@nestjs/bullmq@^11.0.4`, `bullmq@^5.79.2`

### phase-03-videos/TD-05

**Recommendation:** Option A (Direct FFmpeg/ffprobe CLI) - uses canonical media tooling without wrapper drift.

**Libraries:** System `ffmpeg` package installed in the worker image.

### phase-03-videos/TD-06

**Recommendation:** Option B (Random public id + unique DB constraint) - stable, collision-resistant, and independent from title/rename product questions.

**Libraries:** Node.js `crypto`

### phase-03-videos/TD-07

**Recommendation:** Option A (API Range proxy + download stream) - centralizes status/auth checks while satisfying browser Range streaming.

**Libraries:** `@aws-sdk/client-s3@^3.1079.0`, NestJS `StreamableFile`

### phase-03-videos/TD-08

**Recommendation:** Option A (Persist lifecycle status and processing errors on `videos`) - makes processing state durable, queryable, and testable.

**Libraries:** TypeORM/PostgreSQL already in project.

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01 to TD-04

Backend config uses `@nestjs/config`, Joi validation, namespaced `registerAs()` factories, and a shared TypeORM config factory imported by both NestJS runtime and the TypeORM CLI. Phase 03 must add `storage`, `queue`, and `video` config namespaces instead of inline `process.env` reads.

**Libraries:** `@nestjs/config@^4.x`, `joi@^18.1.2`, TypeORM/PostgreSQL already installed.

### phase-02-auth/TD-06 and TD-07

Request DTO validation uses `class-validator` + `class-transformer`, and errors use the existing domain exception envelope `{ statusCode, error, message }`. Phase 03 must extend the same error catalog style for upload, processing, streaming, and authorization failures.

**Libraries:** `class-validator@^0.14.4`, `class-transformer@^0.5.1`

### phase-02-auth/TD-02 and TD-03

Authenticated upload/management endpoints inherit the custom JWT guard and refresh-token auth model. Anonymous access is allowed only for public video read/stream/download endpoints where the video is `ready`.

**Libraries:** `@nestjs/jwt@^11.0.2`

### openapi-docs-nestjs/TD-01 to TD-03

API contracts must be documented with `@nestjs/swagger`, runtime docs remain disabled in production, and the static OpenAPI artifact must be regenerated when video endpoints are added.

**Libraries:** `@nestjs/swagger@^11.4.2`

## Inherited Conventions

- Docker-container communication must use Compose service names (`db`, `redis`, `minio`, `mailpit`, `nestjs-api`, `video-worker`) instead of `localhost` inside container env.
- Feature code lives in domain modules. Phase 03 adds `VideosModule` and keeps storage/queue/worker concerns behind providers rather than spreading SDK calls across controllers.
- Controllers remain thin: DTO validation, auth decorators, and response mapping; services own orchestration and repositories/storage adapters own persistence/external IO.
- TypeORM entities must use explicit table names, explicit column types, timestamps, migrations, and indexes for query/constraint columns.
- Multi-step writes that can leave inconsistent state must use `DataSource.transaction()` or a clear compensating strategy.
- Tests follow the NestJS testing guide: unit for pure/domain logic, integration for database and external adapters, E2E for HTTP contracts.

## Inherited Deferred Capabilities

_No inherited deferred capabilities that block Phase 03._

## Non-UI / Deferred Capabilities

| Capability | Status | Rationale | TD refs |
|------------|--------|-----------|---------|
| Video upload/playback UI in `next-frontend/` | deferred | The phase specification explicitly says the frontend video UI is out of scope. Backend contracts are exposed for future UI work. | phase-03-videos/TD-02, phase-03-videos/TD-07 |
| Publication/visibility workflow | deferred | Phase 03 covers upload/processing/streaming primitives. Editorial publication rules belong to a later product phase. | phase-03-videos/TD-08 |
| Adaptive streaming / transcoding variants | deferred | Phase 03 requires metadata extraction and thumbnail generation, not HLS/DASH or quality ladders. | phase-03-videos/TD-05 |

## Tooling and Documentation Lookup

Context7 MCP lookup is required by the project instructions, but no Context7 MCP tool is exposed in this Codex session after tool discovery. The resolve artifact for this phase therefore records official primary documentation references as a fallback and flags this operational limitation explicitly.

## Testing Requirements

Refer to the `testing-guide-nestjs-project` Skill for layer requirements per artifact type in `nestjs-project/`. Phase 03 introduces a domain module, TypeORM entity/migration, S3 adapter, BullMQ producer/processor, worker bootstrap, FFmpeg process wrapper, streaming/download controllers, and OpenAPI contract updates. Each SI in `phase-03-videos.md` records targeted unit, integration, and E2E coverage.
