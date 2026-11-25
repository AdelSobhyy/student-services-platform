#!/usr/bin/env bash
# Fetch the SonarQube gate verdict and project measures, save the evidence JSON,
# and enforce the assignment thresholds independently of the server's gate config.
set -euo pipefail

: "${SONAR_HOST_URL:?Set SONAR_HOST_URL to a server reachable from this runner}"
: "${SONAR_TOKEN:?Supply a project analysis token through CI credentials}"

project="${SONAR_PROJECT_KEY:-student-services-platform999998888889999988}"
report="pm2-java/target/sonar-quality-gate.json"
mkdir -p "$(dirname "$report")"

api() {
  curl --silent --show-error --fail --max-time 30 \
    --header "Authorization: Bearer ${SONAR_TOKEN}" \
    "$SONAR_HOST_URL/$1"
}

status=$(api "api/qualitygates/project_status?projectKey=${project}")
measures=$(api "api/measures/component?component=${project}&metricKeys=coverage,duplicated_lines_density")

jq -n --argjson status "$status" --argjson measures "$measures" \
  '{qualityGate: $status, measures: $measures}' >"$report"

gate=$(jq -r '.projectStatus.status // "UNKNOWN"' <<<"$status")
coverage=$(jq -r '[.component.measures[]? | select(.metric == "coverage") | .value] | .[0] // "0"' <<<"$measures")
duplication=$(jq -r '[.component.measures[]? | select(.metric == "duplicated_lines_density") | .value] | .[0] // "0"' <<<"$measures")

echo "SonarQube gate: ${gate}; coverage: ${coverage}%; duplicated lines: ${duplication}%"

failed=0
if [[ "$gate" != "OK" ]]; then
  echo "SonarQube quality gate did not pass." >&2
  jq -r '.projectStatus.conditions[]? | select(.status != "OK") | "  \(.metricKey): \(.actualValue) (limit \(.errorThreshold))"' <<<"$status" >&2
  failed=1
fi
if ! awk -v value="$coverage" 'BEGIN { exit !(value + 0 >= 80) }'; then
  echo "Coverage ${coverage}% is below the required 80%." >&2
  failed=1
fi
if ! awk -v value="$duplication" 'BEGIN { exit !(value + 0 <= 3) }'; then
  echo "Duplicated lines ${duplication}% exceed the allowed 3%." >&2
  failed=1
fi
exit "$failed"
