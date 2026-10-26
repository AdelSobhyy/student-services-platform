# Docker and GHCR development foundation

## Scope

This is a runnable infrastructure foundation for eight services, not a completed Student Services Platform. Each service exposes read-only seeded sample data in a minimal PostgreSQL table. The tables are not the complete ERDs. Authentication, booking, meal ordering, payments/refunds and notification delivery are not implemented. The sample payment is a label only; it does not process money. There is no frontend yet.

## Start

Install Docker Desktop with Compose v2 (or Docker Engine and Compose). From the repository root run:

```sh
docker compose up
```

Compose builds missing local images, initializes eight independent PostgreSQL databases and waits for database and user-service readiness. Ports 3001 through 3008 are bound to localhost only. Database ports are not published. The built-in password is deliberately a public, local development default. Never use it in production. An optional `.env` can override values from `.env.example`; do not commit secrets. Passwords in DATABASE_URL must be URL-safe or percent-encoded.

Run in the background and verify:

```sh
docker compose up --build -d --wait
node scripts/smoke.mjs
```

The smoke script requires Node 24 or newer locally. Services use ports 3001 user, 3002 accommodation, 3003 transport, 3004 club, 3005 dining, 3006 communication, 3007 library, 3008 payment. Visit `/ready`, `/dependencies` and the `/api/` resource listed in each service README. All non-user services check the user-service through Compose DNS. These are connectivity checks, not implemented business integrations.

`docker compose down` stops the stack and keeps data. Initial SQL runs only on empty database volumes. After schema changes use migrations; do not erase data merely to rerun seeds. `docker compose down --volumes` deletes all demo database data and should only be used intentionally.

## Multi-stage images

Each service has its own Dockerfile and independent npm lockfile. Dependencies are installed with npm ci. Unit tests execute in a test stage. The final non-root runtime copies source from the successful test stage and only production dependencies, so test failure prevents the image build. Application health checks query PostgreSQL via /ready.

## CI and registry

`.github/workflows/containers.yml` validates Compose, builds the eight images, starts all 16 containers and exercises real database reads and user-service connectivity. Pull requests and feature branches verify without publishing. Successful main/develop runs publish eight images using GITHUB_TOKEN with packages:write. No personal access token is required. main gets latest, develop gets develop; both get immutable commit-SHA tags.

Image pattern: `ghcr.io/adelsobhyy/student-services-platform-<service>:<commit-sha>`.

New GHCR packages may default to private even when the repository is public. In each package's settings, choose Public if required for your submission. Only do this for these intended project images. To verify publication, inspect Packages and pull an image with its exact SHA tag. Publishing is not complete merely because the YAML exists.

To run published images after a successful develop publication, set IMAGE_TAG=develop, authenticate if packages are private, and run `docker compose pull` followed by `docker compose up --no-build`.

## Submission evidence

Capture each multi-stage Dockerfile, Compose's healthy service list, successful smoke output, the green workflow run, and eight actual GHCR packages with tags. Record the tested commit SHA. Do not describe scaffolding or an unexecuted workflow as completed business functionality or a passing pipeline.
