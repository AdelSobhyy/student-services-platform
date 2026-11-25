#!/bin/sh
set -eu
: "${SONAR_HOST_URL:?Set SONAR_HOST_URL to a server reachable from this runner}"
: "${SONAR_TOKEN:?Supply a project analysis token through CI credentials}"

mvn --batch-mode -f pm2-java/pom.xml \
  org.sonarsource.scanner.maven:sonar-maven-plugin:5.1.0.4751:sonar \
  -Dsonar.qualitygate.wait=true -Dsonar.qualitygate.timeout=300

# Independently enforce coverage >= 80% and duplication <= 3% and save the verdict.
bash scripts/pm2/verify-quality-gate.sh
