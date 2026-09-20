#!/usr/bin/env bash
# F-06 -- deploy both apps, in the order that keeps a bad release off the internet.
#
#   ./deploy/release.sh            both
#   ./deploy/release.sh render     one
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-both}"

# The dashboard first: its release_command runs the migrations, and migrations are
# expand-only, so the renderer's older code keeps working against the new schema. The
# reverse order would have the renderer expecting columns that do not exist yet.
deploy_app() {
  echo "==> awning-app"
  fly deploy -c fly.app.toml --build-arg APP=app --remote-only
}
deploy_render() {
  echo "==> awning-render"
  fly deploy -c fly.render.toml --build-arg APP=render --remote-only
}

case "$TARGET" in
  app)    deploy_app ;;
  render) deploy_render ;;
  both)   deploy_app; deploy_render ;;
  *) echo "usage: release.sh [app|render|both]"; exit 1 ;;
esac

echo
echo "==> health"
for host in app.awning.au sites.awningsites.com; do
  printf '%s ' "$host"
  curl -fsS "https://${host}/api/health/deep" || echo "UNHEALTHY"
  echo
done
