#!/bin/sh
# Container entrypoint. APP = api | web | worker. PORT is set by the host (Railway); defaults suit local Docker.
set -e
cd /app
case "$APP" in
  api)
    echo "applying database migrations"
    pnpm --filter @triphub/database exec prisma migrate deploy
    if [ "$DEMO_SEED" = "1" ]; then echo "seeding demo data (DEMO_SEED=1)"; pnpm --filter @triphub/api exec tsx src/seed.ts || echo "seed failed (continuing)"; fi
    export API_PORT="${PORT:-4000}"
    if [ "$RUN_WORKER" = "1" ]; then
      # Small deployments run the background worker inside the API container (one service fewer).
      echo "starting worker alongside the API (RUN_WORKER=1)"
      node apps/worker/dist/main.js &
    fi
    exec node apps/api/dist/main.js
    ;;
  web)
    exec pnpm --filter @triphub/web exec next start -p "${PORT:-3000}"
    ;;
  worker)
    exec node apps/worker/dist/main.js
    ;;
  *)
    echo "APP must be api, web or worker (got '$APP')"; exit 1
    ;;
esac
