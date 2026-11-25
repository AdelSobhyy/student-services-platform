# Student Services Platform

A full-stack student services platform with eight PostgreSQL-backed microservices and a browser client.

| Area | Technology |
| --- | --- |
| Backend | Node.js 24, Express 5, PostgreSQL 17 |
| Frontend | Dependency-free single-page app, served by Nginx |
| Containers | Docker Compose |
| CI / registry | GitHub Actions, GHCR |
| PM2 design model | Java 21, JUnit 5, Mockito, JaCoCo |

## Demo accounts

The user service creates these accounts on first start:

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@campus.edu` | `Admin123!` |
| Student | `student@campus.edu` | `Student123!` |
| Club leader | `leader@campus.edu` | `Leader123!` |
| Staff | `staff@campus.edu` | `Staff123!` |

Seed accounts use stable IDs shared by all services, so the student and club-leader demos already own seeded bookings, orders, notifications, memberships and club events. New students can register from the login screen.

## Quick start

```sh
docker compose up --build
```

Open <http://localhost:8080> for the frontend. The services are also published on localhost:

| Service | Port | Requirements |
| --- | --- | --- |
| user-service | 3001 | FR1–FR3 |
| accommodation-service | 3002 | FR4–FR7 |
| transport-service | 3003 | FR8–FR10 |
| club-service | 3004 | FR11–FR14 |
| dining-service | 3005 | FR15–FR18 |
| communication-service | 3006 | FR19–FR22 |
| library-service | 3007 | FR23 |
| payment-service | 3008 | FR24 |

Stop the stack with `docker compose down`. Add `--volumes` only when you intentionally want to delete demo data.

## Functional coverage

| Requirements | Implemented features |
| --- | --- |
| FR1 Manage Authentication | Register, login, password recovery and reset |
| FR2 Manage User Profile | View/update profile, aggregated activity history |
| FR3 Manage System Roles | Create staff accounts, assign roles, suspend/deactivate/reactivate |
| FR4 Browse Accommodations | List, filter by price/capacity/availability/building |
| FR5 Manage Housing Bookings | Book with overlap checks, cancel and release room, automatic payment |
| FR6 Manage Room Inventory | Building/room CRUD, availability and maintenance status |
| FR7 Manage Accommodation Reviews | Submit review after a completed stay, view ratings |
| FR8 Browse Transport Routes | Route and schedule browsing |
| FR9 Manage Transport Bookings | Seat booking with capacity enforcement, cancel and release |
| FR10 Manage Route | Route and schedule CRUD |
| FR11 Browse Clubs | Browse and search by category/interest |
| FR12 Manage Memberships | Join and leave clubs |
| FR13 Manage Club Events | Club-leader/admin event CRUD, joined-club event feed |
| FR14 Manage Club Approvals | Propose, approve, reject and suspend clubs |
| FR15 Browse Dining Menus | Daily menus, meal details, ingredients and nutrition |
| FR16 Manage Meal Orders | Order meals, cancel before deadline |
| FR17 Manage Kitchen Inventory | Meal CRUD, available/out-of-stock status |
| FR18 Manage Dietary Preferences | Save restrictions/allergies, highlight conflicts |
| FR19 Manage Notifications | Automatic notifications, admin broadcasts, read state |
| FR20 Manage Support Tickets | Submit, view, respond, resolve |
| FR21 Manage Analytics and Reports | Admin summary statistics and club CSV report |
| FR22 Manage System Settings | Semester dates, announcements |
| FR23 Manage Library Resources | Search, reserve printed books, download digital items, collect/cancel/return, catalog CRUD |
| FR24 Manage Payments | Pay fees, receipts, refund requests, approve/reject/issue refunds |

The exact endpoint contract is in [docs/service-api.md](docs/service-api.md).

## Architecture

```text
Browser (frontend :8080)
  ├─ user-service :3001 ─────────── user-db
  ├─ accommodation-service :3002 ── accommodation-db
  ├─ transport-service :3003 ────── transport-db
  ├─ club-service :3004 ─────────── club-db
  ├─ dining-service :3005 ───────── dining-db
  ├─ communication-service :3006 ── communication-db
  ├─ library-service :3007 ──────── library-db
  └─ payment-service :3008 ──────── payment-db
```

Each service owns its database. Services communicate through authenticated internal HTTP calls:

- payment charges/refunds for accommodation, transport and dining;
- communication notifications for bookings, orders, payments and tickets;
- user activity history aggregating peer activity feeds;
- communication analytics/report aggregating peer statistics.

Internal calls require the shared `SERVICE_TOKEN`. User requests use a signed bearer token issued by `user-service`; all services verify it with the shared `AUTH_SECRET`.

For local development the defaults in `.env.example` are used. Change `AUTH_SECRET`, `SERVICE_TOKEN`, and `DEV_DB_PASSWORD` outside local development.

## Tests

Run all backend suites:

```sh
npm test
```

Run syntax checks:

```sh
npm run check
```

Each service also runs its own suite with `npm test --prefix services/<service>`. Tests use `pg-mem` so they do not need a running database. The Docker test stage executes the same suites before an image can be published.

With the stack running, execute end-to-end smoke checks:

```sh
npm run smoke
```

If Docker is unavailable, `npm run dev:memory` starts all eight services with in-memory `pg-mem` databases and serves the same frontend on port 8080. Data is reset whenever that process restarts; use Compose for a persistent stack.

## PM2 Java design model

The `pm2-java` module contains the PM2 object/sequence/collaboration/state implementation model with JUnit and Mockito tests. The 202 test executions include all 105 valid/invalid rows in `transitions.csv`, manager-level tests for every state transition, and `Mockito.verify()` assertions for collaboration messages. Shared object-diagram instances live in `Fixtures.java`. Build it with:

```sh
mvn --batch-mode -f pm2-java/pom.xml clean verify
```

`verify` enforces a JaCoCo bundle minimum of 80% instruction and branch coverage. GitHub Actions uploads Surefire/JaCoCo reports and runs the SonarQube gate (coverage ≥ 80%, duplicated lines ≤ 3%); the Jenkinsfile runs the same Maven build, publishes JUnit, archives JaCoCo and enforces the same gate. See `docs/devops.md` for the CI comparison.

## Team and branches

| Member | GitHub | Requirements |
| --- | --- | --- |
| Emadaldin Mohamed | @engemadmohamed | FR1–FR4 |
| Youssef Hesham | @yousefmohamed90 | FR5–FR8 |
| Marwan Tamer | @Marwantamer4444 | FR9–FR12 |
| Adel Sobhy | @AdelSobhyy | FR13–FR16 |
| Mohamed Essam | @mohamedessam91011 | FR17–FR20 |
| Youssef Mohamed | @yy0446419-lab | FR21–FR24 |

- `main`: stable code, changes through reviewed pull requests.
- `develop`: integration branch.
- `feature/<service-name>`: per-service feature branch.
- Feature pull requests target `develop`; releases target `main`.

Jira board: <https://youseff0hishodent.atlassian.net/jira/software/projects/SSP/boards/34>
