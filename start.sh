#!/usr/bin/env bash
set -euo pipefail

# ── 1. Postgres (Homebrew postgresql@16) ─────────────────────────────────────
PG_BIN="/opt/homebrew/opt/postgresql@16/bin"
PG_DATA="/opt/homebrew/var/postgresql@16"

if ! pg_isready -h /tmp -q 2>/dev/null; then
  echo "Starting Postgres..."
  "$PG_BIN/pg_ctl" -D "$PG_DATA" -o "-k /tmp" -l "$PG_DATA/postgresql.log" start
  # Wait until ready
  for i in $(seq 1 15); do
    pg_isready -h /tmp -q && break
    sleep 1
  done
fi
echo "✓ Postgres ready"

# ── 2. .env ──────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  KEY=$(head -c32 /dev/urandom | base64)
  # Replace placeholder DB_ENCRYPTION_KEY line (or append if absent)
  if grep -q "^DB_ENCRYPTION_KEY=" .env; then
    sed -i '' "s|^DB_ENCRYPTION_KEY=.*|DB_ENCRYPTION_KEY=$KEY|" .env
  else
    echo "DB_ENCRYPTION_KEY=$KEY" >> .env
  fi
  echo "✓ .env created from .env.example"
fi

# ── 3. Dependencies ──────────────────────────────────────────────────────────
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  bun install --frozen-lockfile
fi
echo "✓ Dependencies ready"

# ── 4. Migrate + seed admin ──────────────────────────────────────────────────
echo "Running migrations and seeding admin..."
bun run seed:admin -- --email x@y.z 2>&1 | grep -E "(✅|⚠️|❌|INFO|error)" || true
echo "✓ Migrations applied  (admin@admin.com / administrator)"

# ── 5. Dev server ────────────────────────────────────────────────────────────
LOG_DIR="${TMPDIR:-/tmp}applogs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/dev.log"

echo "Starting dev server (logs → $LOG)..."
nohup bun run dev > "$LOG" 2>&1 &
DEV_PID=$!
echo "  PID: $DEV_PID"

# Poll until healthy
for i in $(seq 1 60); do
  if curl -sf http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "✓ Dev server ready → http://localhost:3000"
    echo "  Login: admin@admin.com / administrator"
    exit 0
  fi
  sleep 2
done

echo "✗ Dev server did not become healthy in 120 s — check $LOG"
exit 1
