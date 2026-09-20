#!/usr/bin/env bash
# F-06 -- push secrets to Fly from a local .env.production.
#
#   ./deploy/secrets.sh awning-app .env.production
#
# Fly restarts the app once per `secrets set` call, so everything goes in ONE call.
# Secrets never enter the image, the repo, or CI logs.
set -euo pipefail

APP="${1:?usage: secrets.sh <fly-app-name> [env-file]}"
ENV_FILE="${2:-.env.production}"
[ -f "$ENV_FILE" ] || { echo "no $ENV_FILE — copy .env.example and fill it in"; exit 1; }

# Which variables each app actually needs. The renderer never sees Stripe or Anthropic
# keys: it serves public websites, and a key it cannot use is a key that cannot leak
# from it.
# SENTRY_AUTH_TOKEN is deliberately absent: it uploads source maps at BUILD time and a
# running machine has no use for it, so it does not belong in the runtime secret set.
COMMON="DATABASE_URL APP_DATABASE_URL DIRECT_URL REDIS_URL SITES_ROOT_DOMAIN APP_URL
        R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET CDN_BASE_URL
        SENTRY_DSN NEXT_PUBLIC_SENTRY_DSN SENTRY_ENVIRONMENT SENTRY_TRACES_SAMPLE_RATE
        LOG_LEVEL"
APP_ONLY="BETTER_AUTH_SECRET ANTHROPIC_API_KEY AI_DAILY_CEILING_CENTS
          STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_CONNECT_WEBHOOK_SECRET
          CF_API_TOKEN CF_ZONE_ID_SITES CF_ACCOUNT_ID CF_CNAME_TARGET
          RESEND_API_KEY SMTP_URL TURNSTILE_SECRET CRON_SECRET OPS_EMAIL
          PREVIEW_BASE_URL CANARY_BASE_URL"

case "$APP" in
  *render*) WANTED="$COMMON" ;;
  *)        WANTED="$COMMON $APP_ONLY" ;;
esac

args=(); missing=()
for key in $WANTED; do
  value="$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//')"
  if [ -z "$value" ]; then missing+=("$key"); else args+=("${key}=${value}"); fi
done

if [ ${#missing[@]} -gt 0 ]; then
  echo "empty in $ENV_FILE, skipping: ${missing[*]}"
  echo
fi
[ ${#args[@]} -gt 0 ] || { echo "nothing to set"; exit 1; }

echo "setting ${#args[@]} secrets on $APP"
fly secrets set --app "$APP" --stage "${args[@]}"
echo "staged. they apply on the next deploy — run ./deploy/release.sh"
