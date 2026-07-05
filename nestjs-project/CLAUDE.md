# CLAUDE.md

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, etc.) — **never** start the NestJS application server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"
```

Then verify each infrastructure service is actually ready to accept connections — not just running:

- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`
- **Redis:** `docker compose exec redis redis-cli ping` — expect `PONG`
- **MinIO:** `docker compose ps minio minio-init` — expect `minio` healthy/running and `minio-init` completed successfully

Only start the NestJS dev server (`npm run start:dev`) when the user **explicitly** asks to run the application — never as part of "start the environment".
The default full runtime includes `video-worker`; for infrastructure-only checks, start only `db`, `mailpit`, `redis`, `minio`, and `minio-init` explicitly.

## Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start full runtime containers
docker compose up -d

# Dependencies are installed during Docker image build and exposed through
# the node-modules named volume.

# Run the dev server (watch mode)
docker compose exec nestjs-api npm run start:dev
```

Services:
- `nestjs-api` — NestJS API, port `3000`
- `db` — PostgreSQL 17, port `5432`, database `streamtube`, user/password `streamtube`
- `mailpit` — local SMTP service, SMTP port `1025`, Web UI port `8025`
- `redis` — BullMQ broker, port `6379`
- `minio` — S3-compatible object storage, API port `9000`, Console port `9001`
- `minio-init` — one-shot bucket bootstrap for `streamtube-videos` and `streamtube-thumbnails`
- `video-worker` — dedicated NestJS worker for BullMQ video processing, included in the default Compose runtime

## Phase 03 Video Module

The `src/videos/` module implements backend video upload, processing, public playback, and download. The API never receives the full video body; clients upload directly to MinIO/S3 with presigned multipart URLs.

Video lifecycle:

- `draft` — created by upload initiation before bytes are uploaded.
- `processing` — multipart upload completed and BullMQ job published.
- `ready` — worker extracted duration/metadata, generated thumbnail, and persisted storage keys.
- `error` — queue or worker failure persisted with diagnostic fields.

HTTP endpoints:

- `POST /videos/uploads` — auth required; creates draft upload and returns multipart upload id/part plan.
- `POST /videos/uploads/:videoId/parts` — owner-only; returns presigned part URLs.
- `POST /videos/uploads/:videoId/complete` — owner-only; completes multipart upload and enqueues `process-video`.
- `DELETE /videos/uploads/:videoId` — owner-only; aborts a draft multipart upload.
- `GET /videos/uploads/:videoId/status` — owner-only; returns lifecycle state and processing errors.
- `GET /videos/:publicId` — public metadata for `ready` videos only.
- `GET /videos/:publicId/thumbnail` — public thumbnail image for `ready` videos that have a generated thumbnail.
- `GET /videos/:publicId/stream` — public ready-video streaming with single HTTP byte Range support.
- `GET /videos/:publicId/download` — public ready-video attachment download.

Storage and queue conventions:

- Original video keys: `channels/{channelId}/videos/{videoId}/original/{safeFileName}`
- Thumbnail keys: `channels/{channelId}/videos/{videoId}/thumbnails/default.jpg`
- Buckets: `streamtube-videos`, `streamtube-thumbnails`
- Queue: `video-processing`
- Job name: `process-video`
- Idempotent job id: `process-video-{videoId}`

All verification and teardown commands run on the **host machine**:

```bash
# Verify NestJS is running (expect 200 + "Hello World!")
curl http://localhost:3000

# Verify PostgreSQL is ready (runs inside the db container)
docker compose exec db pg_isready -U streamtube
docker compose exec redis redis-cli ping

# Check container logs
docker compose logs nestjs-api
docker compose logs video-worker
docker compose logs db
docker compose logs redis
docker compose logs minio

# Tear down the entire environment
docker compose down
```

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host. Running on the host causes env-var divergence, uses a different Node version, and produces results that do not reflect what runs in CI/prod.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run start:worker:dev                 # Video worker with hot-reload (explicit worker runs only)
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build
npm run start:worker:prod                # Run compiled video worker

npm test                                 # Unit tests
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (always with --runInBand)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint with auto-fix
npm run format                           # Prettier formatting
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs nestjs-api
docker compose logs video-worker
docker compose exec db pg_isready -U streamtube
docker compose exec redis redis-cli ping
curl http://localhost:3000
```

### Worker runtime

`video-worker` is a real Compose service in the default runtime, so `docker compose up -d` starts the worker together with the API and infrastructure. For infrastructure-only startup, list only infrastructure services:

```bash
docker compose up -d db mailpit redis minio minio-init
```

Inside containers, service-to-service env vars must use Compose service names:

```dotenv
STORAGE_ENDPOINT=http://minio:9000
QUEUE_REDIS_HOST=redis
DB_HOST=db
MAIL_HOST=mailpit
```

### Test execution

Integration and e2e suites share a single test database. They **must** be run with `--runInBand`:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e   # already configured
```

Parallel execution causes FK violations, deadlocks, and cross-suite contamination because suites truncate or seed shared tables concurrently.

During active development, run only the tests related to the file being changed (`npm test -- path/to/file.spec.ts`). Before declaring a task done, run the full suite — see the global `CLAUDE.md` → "Definition of Done (Technical)".

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `test:watch`, and any other persistent process.

## Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives. The suffix is a contract that drives Jest config (`testRegex`, parallelism), CI steps, and reader expectations.

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

Conventions for **how to write** each kind of test (mocking patterns, AAA structure, override strategies for global guards, etc.) live in `.claude/rules/nestjs-testing.md` and load when you edit a test file.

## Jest Configuration

These settings are required in `package.json` (jest config) and `test/jest-e2e.json` for the project's tests to work correctly:

- `setupFiles: ["dotenv/config"]` — without this, `.env` is not loaded inside the Jest process. `DB_HOST`, `JWT_SECRET`, etc. fall back to code defaults instead of the Compose-specific `.env` values.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit (`*.spec.ts`) and integration (`*.integration-spec.ts`) suffixes.

Do not add new test-file suffixes; if a new test type is needed, update the regex deliberately.

## Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted** or rewritten:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax and break parsing
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code (e.g., in `mail.config.ts`) so the file stays shell-safe.

## Build Assets

`tsc` (and therefore `nest build`) only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev). Without that, the file exists in `src/` but is missing in `dist/` and runtime fails only after build.

## Architecture

NestJS with standard module structure. Source lives in `src/`, compiled output in `dist/`.

- Each domain feature gets its own module (e.g., `UsersModule`, `VideosModule`) registered in `AppModule`
- Controllers handle HTTP routing; Services hold business logic; both are scoped to their module

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.
