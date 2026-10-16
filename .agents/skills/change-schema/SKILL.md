---
name: change-schema
description: Steps for changing the SQLite database schema with Drizzle, covering tables, columns, generated migrations and seed data. Use this when adding, altering, renaming or removing a table or column, or when changing default rows.
---

# Change the database schema

The schema files in `src/db/schema/` are the source of truth. Migrations are generated from them and applied at startup.

## Steps

1. **Edit the schema.** One table per file in `src/db/schema/`. Follow `src/db/schema/kv.ts`, and export:
    - the table, as `<name>Table`
    - the Zod schemas from `createInsertSchema` / `createSelectSchema` (`drizzle-orm/zod`). Pass stricter field rules as the second argument
    - one schema for what the API returns, and one per request body with `.pick()` of the fields a client may set
    - the inferred TypeScript type

    For the columns:
    - **`.notNull()`** on every column that needs a value, the primary key too. SQLite accepts `NULL` in a primary key that is not an integer.
    - **Snake case in SQL** for a property of more than one word: `createdAt: text("created_at")`.
    - **Timestamps** are ISO 8601 text that the database fills, as `createdAt` does.
    - **References:** `.references(() => usersTable.id, { onDelete: "cascade" })`. Foreign keys are enforced.

2. **Generate the migration.**

    ```bash
    bun run db:generate --name add_users_table
    ```

    This creates `src/db/migrations/<timestamp>_<name>/` with `migration.sql` and `snapshot.json`. Commit both.

3. **Read the generated SQL.** SQLite cannot change most column properties in place. So drizzle-kit can rebuild the table: create `__new_<table>`, copy the rows, drop the old table, rename the new one. Check that:
    - the `INSERT INTO ... SELECT` copies every existing column
    - a new `NOT NULL` column has a default. Otherwise the existing rows cannot be copied
    - no `ALTER TABLE ... ADD` adds a column with an expression as its default, such as the `strftime(...)` of `createdAt`. On a table with rows, SQLite refuses it with `Cannot add a column with non-constant default`

    **Try it on real rows.** The tests migrate an empty database, so they pass even when a migration fails on rows. Before you generate, start the server and add a few rows through the API. Then generate and start the server again.

    **Fix wrong SQL** in `migration.sql` before the migration reaches any other database:
    - Add a comment at the top that says what you changed.
    - Leave `snapshot.json` as it was generated.
    - Example: `src/db/migrations/20261009162607_kv_id_and_created_at/migration.sql`. drizzle-kit added two columns with `ALTER TABLE ... ADD`, then rebuilt the table anyway. So the two statements were removed.

4. **Update the seed** if the table needs default rows. Add `src/db/seeds/<table>.ts`, following `src/db/seeds/kv.ts`. Add it to the list in `src/db/seeds/index.ts`, after any table it references.

5. **Update what uses the table:** routes, their schemas and tests.

6. **Verify** with `bun run check`.
    - The tests apply every migration to a fresh database, so a migration with invalid SQL fails here.
    - `test/migrations.test.ts` fails while the schema files have a change that no migration covers.

## Renames

drizzle-kit cannot tell a rename from a drop plus an add. Without a terminal, it stops with exit code 2 and prints the hint it needs. Pass that hint back:

```bash
bun run db:generate --name rename_value_to_content \
    --hints '[{"type":"rename","kind":"column","from":["public","kv","value"],"to":["public","kv","content"]}]'
```

## Changing data, not structure

To backfill or transform existing rows, generate an empty migration and write the SQL yourself:

```bash
bun run db:generate --custom --name backfill_user_roles
```

A custom migration is for data only. drizzle-kit does not see a table or column created in it, so `bun run check` keeps reporting the schema files as changed.

## Foreign keys

The server enforces foreign keys, except while it applies migrations. They are off there because a rebuild drops the old table. With `ON DELETE CASCADE`, that would delete every row that references it.

So a migration that deletes rows or drops a table deletes nothing else. Remove or re-point the rows that reference them in the same migration.

## Rules

- **Never edit or delete an applied migration**, on any database, deployed ones included. `__drizzle_migrations` records applied migrations, and a changed one leaves databases in a state the next migration does not expect. Add a new migration.
- **Redo a local-only migration** from the current task: delete its folder and `./data`, then generate again.
- **Do not write migration folders or `snapshot.json` by hand.** The exceptions: the SQL of a `--custom` migration, and a fix to generated SQL as in step 3.
- **Seeds only fill empty tables.** To change rows in existing databases, use a `--custom` migration.
