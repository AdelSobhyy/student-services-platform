# Student Services Platform

A team monorepo for student identity, accommodation, transport, clubs, dining, communication, library services, and payments.

## Team members

| Member | GitHub | Requirements |
| --- | --- | --- |
| Emadaldin Mohamed | @engemadmohamed | FR1–FR4 |
| Youssef Hesham | @yousefmohamed90 | FR5–FR8 |
| Marwan Tamer | @Marwantamer4444 | FR9–FR12 |
| Adel Sobhy | @AdelSobhyy | FR13–FR16 |
| Mohamed Essam | @mohamedessam91011 | FR17–FR20 |
| Youssef Mohamed | @yy0446419-lab | FR21–FR24 |

## Services and owners

Ownership follows the functional requirement allocation in the project document. Services spanning members’ requirements are shared.

| Service folder / Jira label | Requirements | Owners |
| --- | --- | --- |
| user-service | FR1–FR3 | Emadaldin Mohamed |
| accommodation-service | FR4–FR7 | Emadaldin Mohamed (FR4); Youssef Hesham (FR5–FR7) |
| transport-service | FR8–FR10 | Youssef Hesham (FR8); Marwan Tamer (FR9–FR10) |
| club-service | FR11–FR14 | Marwan Tamer (FR11–FR12); Adel Sobhy (FR13–FR14) |
| dining-service | FR15–FR18 | Adel Sobhy (FR15–FR16); Mohamed Essam (FR17–FR18) |
| communication-service | FR19–FR22 | Mohamed Essam (FR19–FR20); Youssef Mohamed (FR21–FR22) |
| library-service | FR23 | Youssef Mohamed |
| payment-service | FR24 | Youssef Mohamed |

## Planned tech stack

Backend: Node.js 24 with Express 5. Database: PostgreSQL 17, isolated per service. Containers: Docker and Docker Compose. CI and registry: GitHub Actions and GHCR. Frontend remains unselected.

## Planned folder structure

```text
student-services-platform/
  README.md
  frontend/
  services/
    user-service/
    accommodation-service/
    transport-service/
    club-service/
    dining-service/
    communication-service/
    library-service/
    payment-service/
  docs/
  infrastructure/
```

## Branch workflow

- main: stable code, with changes through reviewed pull requests.
- develop: integration branch for ongoing development.
- feature/<service-name>: a feature branch for each service, maintained by the owners above.
- Feature pull requests target develop; release pull requests target main.
- GitHub does not have a separate branch-owner field. The responsibility table identifies the members maintaining each service branch.

## Jira board

[Student Services Platform Jira board](https://youseff0hishodent.atlassian.net/jira/software/projects/SSP/boards/34)


## Development and containers

Chosen stack: Node.js 24, Express 5, PostgreSQL 17. See [Docker and CI instructions](docs/devops.md). Start the eight-service development foundation with `docker compose up`. This is sample infrastructure code; full product features remain to be implemented.
