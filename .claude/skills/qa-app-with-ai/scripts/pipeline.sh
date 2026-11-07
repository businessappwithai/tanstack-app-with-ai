#!/bin/bash
# usage: QA_DIR=/tmp/qa QA_OUT=./qa-out SITE=http://localhost:8080 pipeline.sh <key>
# Put the scripts in $QA_DIR. One model, end to end: download the zip through the site, build and run it
# under docker compose, read the seeder, screenshot reports/charts/dashboards, CRUD six entities by
# clicks, check a narrow reporting role, tear down. Run models one after another, never in parallel.
k=$1; Q=${QA_DIR:-/tmp/qa}; export QA_DIR=$Q; R=$Q/run/$k; L=$Q/log/$k.log; mkdir -p $Q/log $R; : > $L
export NODE_PATH=$(npm root -g)
say(){ echo "[$(date +%T)] $*" | tee -a $L; }
say "== $k: download"; (cd $Q && node dl.js $k >>$L 2>&1) || { say "FAIL download"; exit 1; }
rm -rf $R/*; unzip -q $Q/zips/$k.zip -d $R; D=$(ls -d $R/*/ | head -1); cd $D
say "files: $(find . -type f | wc -l)"
cp .env.example .env; python3 $Q/sandbox-ca.py . >>$L
t0=$(date +%s)
say "compose up --build"; timeout 2400 docker compose up --build -d >>$L 2>&1; rc=$?
say "compose rc=$rc after $(( $(date +%s)-t0 ))s"
if [ $rc -eq 0 ]; then
  for i in $(seq 1 60); do st=$(docker compose ps -a --format '{{.Service}}={{.State}}:{{.ExitCode}}' | tr '\n' ' '); echo "$st" | grep -q "report-seeder=exited" && break; sleep 10; done
  say "state: $st"
  docker compose logs report-seeder 2>&1 | grep -E "^\S+\s+\| \[seed\]" | sed 's/^.*| //' | tee -a $L
  say "app rows: $(docker compose exec -T postgres psql -U app -d $(docker compose exec -T postgres sh -c 'echo $POSTGRES_DB' | tr -d '\r') -Atc "select count(*)||' bus tables, '||coalesce(sum(n_live_tup),0)||' rows' from pg_stat_user_tables where relname like 'bus_%'" 2>&1 | tail -1)"
  say "screenshots"; (cd $Q && node shot.js $k 2>&1 | tee -a $L)
  say "crud (clicks)"; (cd $Q && timeout 900 node crud.js $k AUTO:6 2>&1 | tee -a $L)
  say "role check"; (cd $Q && timeout 300 node rolecheck.js $k 2>&1 | tee -a $L)
else
  say "build tail:"; tail -15 $L | cut -c1-250
  docker compose logs --tail 15 2>&1 | cut -c1-250 | tee -a $L
fi
docker compose down -v --rmi local >>$L 2>&1; docker builder prune -af >/dev/null 2>&1
say "== $k done"
