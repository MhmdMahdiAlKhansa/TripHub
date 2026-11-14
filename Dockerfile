# One image for the whole monorepo; the APP build argument / variable picks what the container runs
# (api, web or worker). Railway passes service variables as build arguments, so each service sets APP.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 CI=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps ./apps
COPY packages ./packages
COPY infrastructure/docker ./infrastructure/docker
RUN pnpm install --frozen-lockfile
ARG APP=api
ARG NEXT_PUBLIC_MAPTILER_KEY
ARG SITE_URL
ENV APP=$APP NODE_ENV=production NEXT_PUBLIC_MAPTILER_KEY=$NEXT_PUBLIC_MAPTILER_KEY SITE_URL=$SITE_URL
RUN pnpm --filter @triphub/shared --filter @triphub/database --filter @triphub/ui run build \
  && if [ "$APP" = "web" ]; then pnpm --filter @triphub/web run build; else pnpm --filter @triphub/api --filter @triphub/worker run build; fi
CMD ["sh", "infrastructure/docker/start.sh"]
