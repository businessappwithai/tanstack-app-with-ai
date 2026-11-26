#!/bin/sh
# The backend container's entrypoint.
#
# It brings the schema up before it starts the API, and it is the only thing in
# the split build that does. `docker-start.sh` already did this for the
# single-image build; the compose file's `backend` service had no equivalent
# step, so `docker compose up` against a fresh volume started the API on an
# empty database and the process died on its first query —
# `relation "sys_system" does not exist` — leaving compose reporting nothing
# more useful than "container is unhealthy".
#
# `migrate` runs the migrations *and* the seeds, and both halves are safe to
# repeat: migrations are tracked by filename and the seeds swallow duplicate
# keys. So this runs on every start rather than only the first. Set
# SKIP_MIGRATE=true where something else owns the schema.
set -e

log() { echo "[backend] $*"; }

cd /app/backend

if [ -n "$DATABASE_URL" ] && [ "${SKIP_MIGRATE:-false}" != "true" ]; then
  # A handful of attempts, not an unbounded wait. Compose already orders this
  # behind `depends_on: postgres: service_healthy`, so the only thing left to
  # absorb is a database that accepts connections a moment before it will serve
  # them. Anything that survives the retries is a real failure — a bad
  # migration, a seed the model cannot satisfy — and looping on it would bury
  # the error in a wall of identical output instead of stopping on it.
  attempts=${DB_SETUP_ATTEMPTS:-5}
  n=1
  while :; do
    if bun run migrate; then
      break
    fi
    if [ "$n" -ge "$attempts" ]; then
      log "database setup failed after $n attempts — see the error above"
      exit 1
    fi
    log "database setup failed (attempt $n of $attempts) — retrying in 3s"
    n=$((n + 1))
    sleep 3
  done
fi

log "starting the API"
# Try node first (if available), fall back to bun
if command -v node >/dev/null 2>&1; then
  exec node -r tsconfig-paths/register /app/backend/dist/src/main.js
else
  export NODE_PATH=/app/node_modules:/app/backend/node_modules
  exec bun run /app/backend/dist/src/main.js
fi
