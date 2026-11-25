# Testing results

## Summary

| Test set | Passed | Failed | Notes |
|---|---:|---:|---|
| Accepted Test Report cases (`TC1.1`–`TC8.4`) | 64 | 0 | All 64 cases from `Test_Report.pdf` passed; IDs are named in the test methods listed in [testing-matrix.md](testing-matrix.md). |
| Node service tests (`node --test`) | 46 | 0 | 8 service suites, one per backend service. |
| JUnit / Mockito tests (`mvn clean verify`) | 202 | 0 | 0 failures, 0 errors, 0 skipped. Includes all 105 rows in `transitions.csv` (68 valid and 37 rejected transitions). |
| End-to-end smoke checks (`npm run smoke`) | 19 | 0 | Health/readiness for 8 services and frontend, plus all functional flows. |

No test failed in the final run. The earlier container startup failure was a PostgreSQL readiness race; it was fixed by changing every database healthcheck to probe TCP with `pg_isready -h 127.0.0.1`, and the rerun passed.

## Coverage report

JaCoCo, measured during `mvn --batch-mode -f pm2-java/pom.xml clean verify`:

| Metric | Covered | Total | Coverage | Gate |
|---|---:|---:|---:|---:|
| Instructions | 3,095 | 3,189 | 97.05% | >= 80% |
| Branches | 266 | 310 | 85.81% | >= 80% |
| Lines | 547 | 550 | 99.45% | reported |

The machine-readable and HTML JaCoCo reports are published as the `pm2-java-reports` artifact on the successful workflow run below. SonarQube independently reported `SonarQube gate: OK; coverage: 94.8%; duplicated lines: 0.0%` (Sonar's coverage scope differs slightly from JaCoCo's).

## Pipeline evidence

- GitHub Actions — PM2 Java quality checks (JUnit, JaCoCo, Sonar gate): https://github.com/AdelSobhyy/student-services-platform/actions/runs/45676358899
- GitHub Actions — Build test and publish containers (full stack + smoke checks): https://github.com/AdelSobhyy/student-services-platform/actions/runs/45676358714
- SonarQube dashboard: https://literature-seem-editorials-players.trycloudflare.com/dashboard?id=student-services-platform999998888889999988
- Jenkins local build #2 (same `Jenkinsfile`): http://localhost:8081/job/student-services-platform/2/consoleText
- Screenshot of the green pipeline run: [pipeline-tests-green.png](evidence/pipeline-tests-green.png)

## Test code

- Test-case ID mapping and links to each method: [testing-matrix.md](testing-matrix.md)
- JUnit/Mockito sources: [pm2-java/src/test/java/edu/aiu/ssp](../pm2-java/src/test/java/edu/aiu/ssp)
- Object-diagram fixtures: [Fixtures.java](../pm2-java/src/test/java/edu/aiu/ssp/Fixtures.java)
- Valid and invalid state transitions: [transitions.csv](../pm2-java/src/test/resources/transitions.csv)
- Service tests: [services](../services) (each service has `test/app.test.js`)
