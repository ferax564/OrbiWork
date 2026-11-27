import { assistantCitationsToPlainText } from "@orbiwork/shared/assistantCitations";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "@orbiwork/shared/composerContextReferences";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";

// SQLite's ltrim needs the characters matched by isAttachmentOnlyBootstrapPrompt's \s explicitly.
const BOOTSTRAP_PREFIX_WHITESPACE =
  "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

export const nonPlaceholderMessageCondition = (sql: SqlClient.SqlClient, row = "messages") =>
  sql.literal(`
  CASE
    WHEN substr(json_extract(${row}.payload_json, '$.text'), 1, 11) = 'Ultrathink:' COLLATE NOCASE
      THEN ltrim(substr(json_extract(${row}.payload_json, '$.text'), 12), '${BOOTSTRAP_PREFIX_WHITESPACE}')
    ELSE json_extract(${row}.payload_json, '$.text')
  END COLLATE BINARY <> '${ATTACHMENT_ONLY_BOOTSTRAP_PROMPT.replaceAll("'", "''")}'
`);

/**
 * Exclude attachment placeholders, generated notices and subagent threads. ACP subagents
 * rewrite their finished answer while it streams.
 * Migration triggers, backfill, rebuild and scans share this predicate; `row` may be `new`.
 */
export const indexedMessageCondition = (sql: SqlClient.SqlClient, row = "messages") =>
  sql`
  ${sql.literal(`
  ${row}.streaming = 0
  AND (
    ${row}.role = 'assistant'
    OR (
      ${row}.role = 'user'
      AND COALESCE(json_extract(${row}.payload_json, '$.createdBy'), 'user') = 'user'
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM orchestration_v2_projection_threads AS subagent_threads
    WHERE subagent_threads.thread_id = ${row}.thread_id
      AND json_extract(subagent_threads.payload_json, '$.lineage.relationshipToParent') = 'subagent'
  )
`)}
  AND ${nonPlaceholderMessageCondition(sql, row)}
`;

// Curly apostrophes straight, as search folds a query, since iOS keyboards
// type "’" and others type "'".
const foldApostrophes = (text: string) => `replace(replace(${text}, '’', ''''), '‘', '''')`;

const readableText = (row: string) =>
  `COALESCE(${row}.search_text, json_extract(${row}.payload_json, '$.text'))`;

// A file mention stores `__init__.py` as `[\_\_init\_\_.py](...)`; the index
// holds the label as it reads, so search can find the name as typed.
const LINK_LABEL = /(!?\[)([^\]\n]*)(\]\([^)\s]*\))/g;

/**
 * What search_text holds for a message: its text as it reads, a quote's
 * percent-encoded link replaced by its words and comment. NULL when that is
 * the stored text, so most messages store nothing extra.
 */
export const readableSearchText = (text: string) => {
  const readable = assistantCitationsToPlainText(text).replace(
    LINK_LABEL,
    (_link, open: string, label: string, close: string) =>
      open + label.replace(/\\([*_])/g, "$1") + close,
  );
  return readable === text ? null : readable;
};

/** A message's text as it reads, for thread search. */
export const messageSearchText = (sql: SqlClient.SqlClient) =>
  sql.literal(readableText("messages"));

/** What the index stores for a message, so a scan matches the folded query as the index does. */
export const foldedMessageSearchText = (sql: SqlClient.SqlClient, row = "messages") =>
  sql.literal(foldApostrophes(readableText(row)));

/**
 * Refills the search index from the messages table. The index is keyed by
 * message rowid, so anything that may renumber or copy rows (VACUUM, a dev
 * database copy) rebuilds it instead of trusting it. A database that
 * has not migrated has no index.
 */
export const rebuildMessageSearch = Effect.fn("MessageSearchIndex.rebuild")(function* (
  sql: SqlClient.SqlClient,
) {
  const index = yield* sql`
    SELECT 1 FROM sqlite_master WHERE name = 'orchestration_v2_message_search'
  `;
  if (index.length === 0) return;
  // One transaction: an interrupt between clear and refill would leave an
  // empty index that nothing repairs, since search only checks the table exists.
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        INSERT INTO orchestration_v2_message_search (orchestration_v2_message_search)
        VALUES ('delete-all')
      `;
      yield* sql`
        INSERT INTO orchestration_v2_message_search (rowid, text)
        SELECT messages.rowid, ${foldedMessageSearchText(sql)}
        FROM orchestration_v2_projection_messages AS messages
        WHERE ${indexedMessageCondition(sql)}
          AND json_extract(messages.payload_json, '$.text') IS NOT NULL
      `;
    }),
  );
});
