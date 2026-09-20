#!/usr/bin/env bash
# F-06 -- the nightly sweep.
#
# There is no third Fly app. The sweep is an HTTP route on the dashboard (domains,
# dunning, digest — two runs a day), and a separate deployable to build, secure and
# operate would be a cost with no benefit at this size. A Fly scheduled machine is a
# cron that curls it.
#
#   ./deploy/schedule-cron.sh
set -euo pipefail
: "${CRON_SECRET:?export CRON_SECRET first — the same value set on awning-app}"

fly machine run \
  --app awning-app \
  --schedule daily \
  --region syd \
  --restart no \
  curlimages/curl:8.10.1 \
  -- -fsS -X POST -H "Authorization: Bearer ${CRON_SECRET}" \
     "https://app.awning.au/api/cron?job=all"

echo
echo "Fly's --schedule daily fires at an unspecified hour UTC. If the 7am digest has to"
echo "land at 7am Adelaide, use GitHub Actions instead (.github/workflows/cron.yml),"
echo "which takes a real cron expression."
