#!/bin/sh
# Bring the generator up in a state someone can actually use.
#
# Three things have to be true before the app is worth serving: the database is
# reachable, its schema is current, and there is a model to design against.
# Doing this here rather than in the app means a container that logs a clear
# reason when one of them is not, instead of a UI that half works.
set -e

log() { echo "[entrypoint] $*"; }

# ── database ────────────────────────────────────────────────────────────────
# A hosted database may be asleep, and a sidecar Postgres is usually still
# starting, so waiting is the normal case rather than the error case.
if [ -n "$DATABASE_URL" ]; then
  log "waiting for the database…"
  attempt=0
  until pg_isready -d "$DATABASE_URL" -q 2>/dev/null; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge "${DB_WAIT_ATTEMPTS:-60}" ]; then
      log "database never became ready after ${attempt} attempts — check DATABASE_URL"
      exit 1
    fi
    sleep 2
  done
  log "database is up"
fi

# ── model ───────────────────────────────────────────────────────────────────
# Seeding also runs the migrations, so a seeded container needs nothing else.
# Re-running on restart is intended: the script updates in place.
if [ -n "$SEED_MODEL" ] || [ -n "$SEED_DATABASE_URL" ]; then
  if [ -n "$SEED_MODEL" ] && [ ! -f "$SEED_MODEL" ]; then
    log "SEED_MODEL=$SEED_MODEL does not exist — did you mount it?"
    exit 1
  fi
  log "seeding the starting model…"
  bun scripts/seed-model.ts
else
  log "no SEED_MODEL or SEED_DATABASE_URL — starting with an empty workspace"
fi

# ── deploy-stage image builds ───────────────────────────────────────────────
# Not fatal. Everything except the deploy step works without it, and saying so
# now is better than a confusing failure twenty minutes into a session.
if [ -S /var/run/docker.sock ]; then
  log "docker socket present — the deploy step can build images"
else
  log "no docker socket mounted — the deploy step cannot build images"
  log "  add: -v /var/run/docker.sock:/var/run/docker.sock"
fi

log "starting: $*"
exec "$@"
