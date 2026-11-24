#!/usr/bin/env bash
set -euo pipefail

# Scan each CI checkout in an isolated SonarQube project with overall-code conditions.
container="pm2-sonar-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
image='sonarqube:26.11.0.134175-community@sha256:7b2296713a92b8ea0dd7a083a25faadc59376c9a1e6daf2744a89711c54ea1ba'
project='student-services-pm2'
gate='PM2 Java overall quality'

docker run --detach --rm --name "$container" --publish 127.0.0.1::9000 \
  --env SONAR_ES_BOOTSTRAP_CHECKS_DISABLE=true "$image" >/dev/null
trap 'docker stop --time 10 "$container" >/dev/null 2>&1 || true' EXIT
export SONAR_HOST_URL="http://$(docker port "$container" 9000/tcp)"

ready=false
for ((attempt=0; attempt<60; attempt++)); do
  if curl --silent --fail --max-time 3 "$SONAR_HOST_URL/api/system/status" |
      jq -e '.status == "UP"' >/dev/null; then
    ready=true
    break
  fi
  sleep 3
done
if [[ "$ready" != true ]]; then
  docker logs --tail 60 "$container" >&2 || true
  echo 'Temporary SonarQube did not become ready.' >&2
  exit 1
fi

admin_password=admin
new_password="Pm2!$(openssl rand -hex 24)"
printf '::add-mask::%s\n' "$new_password"

sonar_api() {
  local endpoint=$1
  shift
  local body
  if ! body=$(curl --fail-with-body --silent --show-error --max-time 20 \
      --user "admin:$admin_password" "$@" "$SONAR_HOST_URL/$endpoint"); then
    printf 'SonarQube API request failed: %s\n' "$endpoint" >&2
    if [[ -n "$body" ]]; then
      jq -r '.errors[]?.msg' <<<"$body" >&2 || true
    fi
    return 1
  fi
  printf '%s' "$body"
}

sonar_api api/users/change_password --data-urlencode login=admin \
  --data-urlencode previousPassword=admin --data-urlencode "password=$new_password" >/dev/null
admin_password=$new_password
sonar_api api/projects/create --data-urlencode "project=$project" \
  --data-urlencode name='Student Services PM2' >/dev/null
sonar_api api/qualitygates/create --data-urlencode "name=$gate" >/dev/null
sonar_api api/qualitygates/create_condition --data-urlencode "gateName=$gate" \
  --data-urlencode metric=coverage --data-urlencode op=LT --data-urlencode error=80 >/dev/null
sonar_api api/qualitygates/create_condition --data-urlencode "gateName=$gate" \
  --data-urlencode metric=duplicated_lines_density --data-urlencode op=GT \
  --data-urlencode error=3 >/dev/null
sonar_api api/qualitygates/select --data-urlencode "projectKey=$project" \
  --data-urlencode "gateName=$gate" >/dev/null
SONAR_TOKEN=$(sonar_api api/user_tokens/generate --data-urlencode name=pm2-ci \
  --data-urlencode type=PROJECT_ANALYSIS_TOKEN --data-urlencode "projectKey=$project" | jq -er .token)
printf '::add-mask::%s\n' "$SONAR_TOKEN"
export SONAR_TOKEN

# This one-checkout Community Build project analyzes its snapshot as the main branch.
scan_result=0
scripts/pm2/quality-gate.sh || scan_result=$?
sonar_api "api/qualitygates/project_status?projectKey=$project" |
  jq . | tee pm2-java/target/sonar-quality-gate.json
exit "$scan_result"
