# syntax=docker/dockerfile:1.7
#
# F-06 -- one image, two apps.
#
# The dashboard and the renderer share every workspace package, so building them from a
# single Dockerfile keeps one dependency graph and one thing to reason about. `--build-arg
# APP=app|render` selects which Next server the image starts.
#
#   docker build --build-arg APP=render -t awning-render .
#
ARG NODE_VERSION=22-bookworm-slim

# ----------------------------------------------------------------- base
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# openssl: Prisma's query engine links against it. ca-certificates: TLS to Neon and Upstash.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

# ----------------------------------------------------------------- deps
# Manifests only, so a source edit does not invalidate the install layer.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/app/package.json            apps/app/
COPY apps/render/package.json         apps/render/
COPY packages/ai/package.json         packages/ai/
COPY packages/api/package.json        packages/api/
COPY packages/auth/package.json       packages/auth/
COPY packages/db/package.json         packages/db/
COPY packages/integrations/package.json packages/integrations/
COPY packages/spec/package.json       packages/spec/
COPY packages/tenancy/package.json    packages/tenancy/
COPY packages/ui-blocks/package.json  packages/ui-blocks/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ----------------------------------------------------------------- build
FROM deps AS build
ARG APP
COPY . .
# The generated catalogue and JSON schema are build outputs; CI checks they match source.
RUN pnpm gen:spec
RUN pnpm --filter @awning/db exec prisma generate
# NEXT_PHASE tells the db client this is a build, not a boot: production boot requires
# APP_DATABASE_URL, and the build legitimately has no secrets.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NEXT_PHASE=phase-production-build
RUN pnpm --filter "@awning/${APP}" build

# Next's file tracing copies the Prisma client's JavaScript but NOT its query engine
# binary, so the container boots, passes a shallow health check, and then fails every
# request that touches the database. Stage the generated client at a fixed path —
# pnpm's own directory is version-hashed and not safe to hardcode.
RUN cp -r /repo/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma /prisma-client \
 && ls /prisma-client/client/*.so.node

# ----------------------------------------------------------------- runtime
FROM base AS runtime
ARG APP
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
ENV APP=${APP}

# Never root. Next writes nothing at runtime; uploads go to R2.
RUN groupadd --system --gid 1001 awning && useradd --system --uid 1001 --gid awning awning

# standalone/ carries the traced server and its node_modules. static/ is not traced
# because nothing imports it — Next expects it copied in beside the server.
COPY --from=build --chown=awning:awning /repo/apps/${APP}/.next/standalone ./
COPY --from=build --chown=awning:awning /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static

# Migrations: the standalone output is a traced Next server, so it carries neither the
# Prisma CLI nor the .sql files. The dashboard's release_command needs both, and it runs
# in this same image. Only that image pays for the CLI.
# `apps/<app>/.prisma/client` is one of the locations Prisma searches at runtime.
COPY --from=build --chown=awning:awning /prisma-client ./apps/${APP}/.prisma

ARG PRISMA_VERSION=5.22.0
COPY --from=build --chown=awning:awning /repo/packages/db/prisma ./prisma
RUN if [ "${APP}" = "app" ]; then npm install -g prisma@${PRISMA_VERSION} && npm cache clean --force; fi

USER awning
EXPOSE 8080
# APP is a build arg, and CMD does not expand those at runtime — resolve it via the env
# var set above rather than baking a path that silently points at the wrong app.
CMD ["sh", "-c", "exec node apps/${APP}/server.js"]
