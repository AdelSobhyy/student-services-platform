# Docker, CI and operations

## Scope

This repository contains a runnable full-stack Student Services Platform:

- eight Node.js 24 / Express 5 services, each with its own PostgreSQL 17 database;
- a dependency-free single-page frontend served by Nginx;
- Docker Compose orchestration;
- GitHub Actions CI, GHCR image publishing and a Jenkins pipeline for the PM2 Java model.

The functional-requirement mapping and endpoint contract are in `README.md` and `docs/service-api.md`.

## Start

Install Docker Desktop with Compose v2, or Docker Engine and Compose. From the repository root:

```sh
docker compose up --build
```

Compose builds the eight service images and the frontend, initializes eight independent databases, and waits for service readiness. The frontend is at <http://localhost:8080>. Service ports 3001–3008 are bound to localhost only. Database ports are not published.

Demo accounts are seeded by `user-service` on first start:

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@campus.edu` | `Admin123!` |
| Student | `student@campus.edu` | `Student123!` |
| Club leader | `leader@campus.edu` | `Leader123!` |
| Staff | `staff@campus.edu` | `Staff123!` |

Verify the running stack:

```sh
node scripts/smoke.mjs
```

`docker compose down` stops the stack and keeps data. Initial SQL runs only on empty database volumes. After schema changes use migrations or recreate local volumes deliberately with `docker compose down --volumes`.

## Configuration

Compose uses local demo defaults. Copy `.env.example` to `.env` to override them.

| Variable | Purpose |
| --- | --- |
| `DEV_DB_PASSWORD` | PostgreSQL password used in local connection strings |
| `AUTH_SECRET` | HMAC secret used to sign and verify user tokens |
| `SERVICE_TOKEN` | Shared secret for service-to-service HTTP calls |
| `GHCR_OWNER` | GitHub owner used in image names |
| `IMAGE_TAG` | Image tag used by Compose |

Never use the demo secrets in a public deployment. The password in `DATABASE_URL` must be URL-safe or percent-encoded.

## Services and databases

Each service owns one database and one `db/init.sql` schema:

| Service | Port | Database | Main tables |
| --- | --- | --- | --- |
| user-service | 3001 | user | users, recovery_tokens |
| accommodation-service | 3002 | accommodation | buildings, rooms, bookings, reviews |
| transport-service | 3003 | transport | routes, schedules, bookings |
| club-service | 3004 | club | clubs, memberships, events |
| dining-service | 3005 | dining | meals, dietary_preferences, orders |
| communication-service | 3006 | communication | notifications, tickets, ticket_messages, announcements, settings |
| library-service | 3007 | library | resources, reservations, downloads |
| payment-service | 3008 | payment | payments, receipts, refunds |

Services expose `/health`, `/ready` and `/dependencies`. The Docker health check uses `/ready`.

## Internal communication

Internal endpoints require `X-Service-Token`:

- `POST <payment>/api/internal/charges`
- `POST <payment>/api/internal/refunds`
- `POST <communication>/api/internal/notifications`
- `GET <peer>/api/internal/activity?studentId=`
- `GET <peer>/api/internal/stats`
- `GET <club>/api/internal/report?type=clubs`
- `GET <user>/api/internal/users`

User requests use `Authorization: Bearer <token>` issued by `user-service`. Tokens contain the user id, role, account status and optional club id. Every service verifies the signature with `AUTH_SECRET`.

## Images

Each service has a multi-stage Dockerfile and independent npm lockfile. Dependencies are installed with `npm ci`. Unit tests run in a test stage with `pg-mem`, so a failing suite prevents the image build. The final non-root runtime copies only production dependencies and source.

The frontend uses `nginx:1.27-alpine` and is intentionally build-free.

## CI and registry

`.github/workflows/containers.yml`:

- validates Compose;
- builds and starts all services and databases;
- runs the end-to-end smoke test;
- publishes nine images (eight services + frontend) on successful `main`/`develop` runs.

Images follow:

```text
ghcr.io/<owner>/student-services-platform-<service>:<commit-sha>
ghcr.io/<owner>/student-services-platform-frontend:<commit-sha>
```

`main` also receives `latest`; `develop` receives `develop`.

`.github/workflows/ci.yml` and `Jenkinsfile` run the PM2 Java Maven build, JUnit/Mockito tests, JaCoCo coverage and the SonarQube quality gate. `mvn verify` fails below 80% instruction or branch coverage (`jacoco:check`). `scripts/pm2/verify-quality-gate.sh` independently checks the Sonar verdict plus coverage ≥ 80% and duplication ≤ 3%, and writes `pm2-java/target/sonar-quality-gate.json` for the artifacts. With `SONAR_HOST_URL` set the real server is used; otherwise `scripts/pm2/quality-gate-ci.sh` starts a temporary SonarQube container with the same gate conditions. See the root README for the SonarQube configuration.

### GitHub Actions vs Jenkins

| Concern | GitHub Actions (`.github/workflows/ci.yml`) | Jenkins (`Jenkinsfile`) |
| --- | --- | --- |
| Trigger | Push/PR to `pm2-devops`, `main`, `develop`, plus manual | Whatever the Jenkins job is configured to listen to |
| Environment | `ubuntu-latest`, Temurin JDK 21, Maven cache | Any agent with JDK 21 and Maven on `PATH` |
| Build | `mvn clean verify` (JUnit, Mockito, JaCoCo `check`) | Same command |
| Test reports | Uploaded as `pm2-java-reports` artifact | Published with the `junit` step |
| Coverage | JaCoCo HTML/XML uploaded with the reports | Archived with `archiveArtifacts` |
| Sonar credentials | `vars.SONAR_HOST_URL` / `secrets.SONAR_TOKEN` | `SONAR_HOST_URL` env / `pm2-sonar-token` credential |
| Sonar gate | `quality-gate.sh` or temporary-container fallback | Same scripts and thresholds |
| Gate evidence | `pm2-sonarqube-gate` artifact | Archived workspace artifact |
| Scope | Java model only; the separate `containers.yml` builds, smoke-tests and publishes images | Java model only; container smoke/publish stays in GitHub Actions |

The two pipelines therefore give equivalent Java quality evidence. The deliberate difference is that image build, Compose smoke and GHCR publishing remain GitHub Actions-only.

## Local test suites

```sh
npm test
npm run check
```

Each service suite uses `pg-mem` and a fake upstream HTTP client, so no database or running peer is required. The Compose smoke test is the integration layer.

## Submission evidence

Capture:

- the green service test output (`npm test`);
- the green Compose smoke output;
- the running frontend at <http://localhost:8080>;
- the green GitHub Actions runs;
- the nine published GHCR packages with their commit-SHA tags.
