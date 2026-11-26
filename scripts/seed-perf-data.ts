/**
 * Performance seed script — loads N rows into bus_branch.
 *
 * Usage:
 *   bun scripts/seed-perf-data.ts
 *   DATABASE_URL=postgresql://... COUNT=50000 bun scripts/seed-perf-data.ts
 *
 * Defaults: shipping_management_system, 50 000 rows, batches of 1000.
 */

import { Client } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://pramodkoshy@localhost/shipping_management_system";
const TOTAL = parseInt(process.env.COUNT ?? "50000", 10);
const BATCH = parseInt(process.env.BATCH ?? "1000", 10);

const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Denver",
  "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Tokyo", "Asia/Singapore",
  "Australia/Sydney",
];

const LEGAL_SUFFIXES = ["LLC", "Ltd", "Inc", "GmbH", "Pte Ltd", "Pty Ltd", "SA", "BV"];

function pad(n: number, len = 6) {
  return String(n).padStart(len, "0");
}

function branchRow(i: number) {
  const ts = new Date().toISOString();
  return {
    name: `Perf Branch ${pad(i)}`,
    code: `PB${pad(i)}`,
    address: `${100 + (i % 900)} Performance Ave, Suite ${i % 50 + 1}, Test City`,
    legal_entity_name: `Perf Branch ${pad(i)} ${LEGAL_SUFFIXES[i % LEGAL_SUFFIXES.length]}`,
    timezone: TIMEZONES[i % TIMEZONES.length],
    tax_registration: `TAX${pad(i, 9)}`,
    is_active: true,
    doc_status: "draft",
    version: 1,
    created_at: ts,
    updated_at: ts,
  };
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log(`Connected → ${DATABASE_URL}`);
  console.log(`Inserting ${TOTAL.toLocaleString()} rows into bus_branch in batches of ${BATCH}…\n`);

  // Remove any previous perf rows so the script is re-runnable.
  const { rowCount: deleted } = await client.query(
    `DELETE FROM bus_branch WHERE code LIKE 'PB%'`
  );
  if ((deleted ?? 0) > 0) console.log(`Removed ${deleted} existing perf rows.\n`);

  const cols = Object.keys(branchRow(0));
  const start = Date.now();
  let inserted = 0;

  for (let b = 0; b < Math.ceil(TOTAL / BATCH); b++) {
    const batchStart = b * BATCH;
    const rows = Array.from(
      { length: Math.min(BATCH, TOTAL - batchStart) },
      (_, j) => branchRow(batchStart + j + 1)
    );
    if (rows.length === 0) break;

    const placeholders = rows
      .map((_, ri) => `(${cols.map((_, ci) => `$${ri * cols.length + ci + 1}`).join(", ")})`)
      .join(", ");
    const values = rows.flatMap((r) => cols.map((c) => (r as Record<string, unknown>)[c]));

    await client.query(
      `INSERT INTO bus_branch (${cols.join(", ")}) VALUES ${placeholders}`,
      values
    );

    inserted += rows.length;
    const pct = Math.round((inserted / TOTAL) * 100);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    process.stdout.write(
      `\r  ${inserted.toLocaleString()} / ${TOTAL.toLocaleString()} (${pct}%) — ${elapsed}s`
    );
  }

  const totalSec = ((Date.now() - start) / 1000).toFixed(2);
  const rps = Math.round(TOTAL / parseFloat(totalSec));
  console.log(
    `\n\nDone. ${TOTAL.toLocaleString()} rows in ${totalSec}s  (${rps.toLocaleString()} rows/sec)`
  );

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
