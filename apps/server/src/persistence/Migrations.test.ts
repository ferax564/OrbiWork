import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@orbiwork/shared/nodeSqliteClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";

const memory = NodeSqliteClient.layer({ filename: ":memory:" });

const history = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  return rows.map((row) => [row.migration_id, row.name] as const);
});

const tableCount = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'orchestration_v2_%'
  `;
  return rows.length;
});

const recordHistory = (rows: ReadonlyArray<readonly [number, string]>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      CREATE TABLE effect_sql_migrations (
        migration_id INTEGER PRIMARY KEY NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        name VARCHAR(255) NOT NULL
      )
    `;
    for (const [id, name] of rows) {
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
    }
  });

describe("runMigrations", () => {
  it.effect("builds a new database from the baseline, then finds nothing to do", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* runMigrations(), [[111, "Baseline"]]);
      assert.deepStrictEqual(yield* history, [[111, "Baseline"]]);
      assert.isAbove(yield* tableCount, 0);
      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(memory)),
  );

  it.effect("builds the schema without search when SQLite cannot create the index", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // An existing table fails the index creation with SQLITE_ERROR, as a missing FTS5 option does.
      yield* sql`CREATE TABLE orchestration_v2_message_search (text TEXT)`;

      assert.deepStrictEqual(yield* runMigrations(), [[111, "Baseline"]]);
      const triggers = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'trigger'
      `;
      assert.isAbove(triggers.length, 0);
      assert.isEmpty(triggers.filter((row) => row.name.includes("message_search")));
    }).pipe(Effect.provide(memory)),
  );

  it.effect("leaves a database at the last pre-baseline migration as it is", () =>
    Effect.gen(function* () {
      const before = [
        [110, "Workflows"],
        [111, "SupersededRunAttemptIndex"],
      ] as const;
      yield* recordHistory(before);

      assert.deepStrictEqual(yield* runMigrations(), []);
      assert.deepStrictEqual(yield* history, before);
      assert.strictEqual(yield* tableCount, 0);
    }).pipe(Effect.provide(memory)),
  );

  it.effect.each([
    [[[110, "Workflows"]], "it stops at 110_Workflows"],
    [[[111, "OtherBuildMigration"]], "111_OtherBuildMigration"],
    [[[112, "FromAnotherBuild"]], "it stops at 112_FromAnotherBuild"],
  ] as const)("refuses a history without the baseline: %j", ([rows, reason]) =>
    Effect.gen(function* () {
      yield* recordHistory(rows);

      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), reason);
      assert.deepStrictEqual(yield* history, rows);
      assert.strictEqual(yield* tableCount, 0);
    }).pipe(Effect.provide(memory)),
  );

  it.effect("still starts after a newer build recorded a later migration", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name) VALUES (112, 'NewerMigration')
      `;

      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(memory)),
  );
});

// The npm launcher reads the highest migration id from these file names.
it.effect("registers every migration file", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.join(import.meta.dirname, "Migrations");
    const files = (yield* fs.readDirectory(dir)).flatMap((name) => {
      const match = /^(\d+)_(\w+)\.ts$/.exec(name);
      return match ? [[Number(match[1]), match[2]] as const] : [];
    });
    assert.deepStrictEqual(
      files.toSorted(([a], [b]) => a - b),
      migrationManifest,
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);
