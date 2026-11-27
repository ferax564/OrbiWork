import * as Migrator from "effect/sql/Migrator";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import {
  DATABASE_MIGRATION_PROGRESS_MESSAGE,
  DATABASE_MIGRATIONS_FINISHED_MESSAGE,
  DATABASE_MIGRATIONS_STARTED_MESSAGE,
} from "@orbiwork/shared/databaseMigrationLog";

import Baseline from "./Migrations/111_Baseline.ts";

const BASELINE_ID = 111;
// The last migration the baseline replaced: a database that recorded it has the baseline schema.
const BASELINE_NAMES: ReadonlyArray<string> = ["Baseline", "SupersededRunAttemptIndex"];

const migrationEntries = [[BASELINE_ID, "Baseline", Baseline]] as const;

export const migrationManifest = migrationEntries.map(([id, name]) => [id, name] as const);

const makeMigrationLoader = (throughId?: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      migrationEntries
        .filter(([id]) => throughId === undefined || id <= throughId)
        .map(([id, name, migration]) => [`${id}_${name}`, migration]),
    ),
  );

/** Why this build cannot open a database with this recorded history, if it cannot. The migrator
 * skips every id up to the highest recorded, so a history without the baseline has no upgrade. */
export function unsupportedMigrationHistory(
  recorded: ReadonlyArray<{ readonly id: number; readonly name: string }>,
): string | undefined {
  if (recorded.length === 0) return undefined;
  const baseline = recorded.find((row) => row.id === BASELINE_ID);
  if (baseline !== undefined && BASELINE_NAMES.includes(baseline.name)) return undefined;
  const latest = recorded.reduce((a, b) => (b.id > a.id ? b : a));
  return baseline === undefined
    ? `it stops at ${latest.id}_${latest.name}, before the ${BASELINE_ID}_Baseline schema this build starts from`
    : `it records ${BASELINE_ID}_${baseline.name} where this build expects ${BASELINE_ID}_Baseline`;
}

const recordedHistory = Effect.fn("recordedHistory")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (tables.length === 0) return [];
  const rows = yield* sql<{
    readonly migration_id: number;
    readonly name: string;
  }>`SELECT migration_id, name FROM effect_sql_migrations`;
  return rows.map((row) => ({ id: row.migration_id, name: row.name }));
});

const latestMigrationId = Math.max(...migrationEntries.map(([id]) => id));

// Mirrors the Migrator, which runs only ids above the highest recorded.
export const hasPendingMigrations = Effect.fn("hasPendingMigrations")(function* () {
  const recorded = yield* recordedHistory();
  return Math.max(0, ...recorded.map((row) => row.id)) < latestMigrationId;
});

const run = Migrator.make({});

export interface RunMigrationsOptions {
  readonly toMigrationInclusive?: number | undefined;
}

export const runMigrations = Effect.fn("runMigrations")(function* ({
  toMigrationInclusive,
}: RunMigrationsOptions = {}) {
  const before = yield* recordedHistory();
  const unsupported = unsupportedMigrationHistory(before);
  if (unsupported !== undefined) {
    return yield* new Migrator.MigrationError({
      kind: "BadState",
      message: `This build cannot open this database's migration history: ${unsupported}. Start the build that wrote it, or move the state directory aside to start fresh.`,
    });
  }
  const latestRecordedId = Math.max(0, ...before.map((row) => row.id));
  // The desktop waits past its readiness budget until the finished line follows this one.
  if (latestRecordedId < latestMigrationId) yield* Effect.log(DATABASE_MIGRATIONS_STARTED_MESSAGE);
  const pending = migrationEntries.filter(
    ([id]) =>
      id > latestRecordedId && (toMigrationInclusive === undefined || id <= toMigrationInclusive),
  );
  // One transaction per migration: an index build on a large database can take minutes, and a
  // restart then resumes after the last finished migration instead of rolling all of them back.
  const executedMigrations: Array<readonly [id: number, name: string]> = [];
  for (const [index, [id, name]] of pending.entries()) {
    if (latestRecordedId > 0) {
      yield* Effect.log(DATABASE_MIGRATION_PROGRESS_MESSAGE).pipe(
        Effect.annotateLogs({
          migration: `${id}_${name}`,
          progress: `${index + 1} of ${pending.length}`,
        }),
      );
    }
    executedMigrations.push(...(yield* run({ loader: makeMigrationLoader(id) })));
  }
  const migrations = executedMigrations.map(([id, name]) => `${id}_${name}`);
  yield* migrations.length === 0
    ? Effect.logDebug("Database schema is current")
    : Effect.log(DATABASE_MIGRATIONS_FINISHED_MESSAGE).pipe(Effect.annotateLogs({ migrations }));

  const manifestNames = new Map<number, string>(migrationEntries.map(([id, name]) => [id, name]));
  const divergent = (yield* recordedHistory()).flatMap((row) => {
    // Ids up to the baseline are the history it replaced.
    if (row.id <= BASELINE_ID) return [];
    const expected = manifestNames.get(row.id);
    if (expected === undefined) return [`${row.id}:${row.name} (unknown to this build)`];
    return expected === row.name ? [] : [`${row.id}:${row.name} (this build: ${expected})`];
  });
  if (divergent.length > 0) {
    yield* Effect.logWarning(
      "Database migration history diverges from this build; recorded migration ids are skipped, not reconciled by name.",
    ).pipe(Effect.annotateLogs({ divergent }));
  }
  return executedMigrations;
});
