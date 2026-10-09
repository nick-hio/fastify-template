---
name: change-schema
description: Steps for changing the SQLite database schema with Drizzle, covering tables, columns, generated migrations and seed data. Use this when adding, altering, renaming or removing a table or column, or when changing default rows.
---

# Change the database schema

The schema files in `src/db/schema/` are the source of truth. Migrations are generated from them and applied automatically when the server starts.

## Steps

1. **Edit the schema.** One table per file in `src/db/schema/`, following `src/db/schema/kv.ts`:
    - export the table as `<name>Table`
    - export the Zod schemas derived from it with `createInsertSchema` / `createSelectSchema` from `drizzle-orm/zod`, passing stricter field rules as the second argument
    - export one schema for what the API returns, and one for each request body with `.pick()` of the fields a client may set
    - export the inferred TypeScript type

    For the columns:
    - put `.notNull()` on every column that needs a value, the primary key included. SQLite accepts `NULL` in a primary key that is not an integer
    - name a column in SQL with snake case when its property has more than one word: `createdAt: text("created_at")`
    - store a timestamp as ISO 8601 text and let the database fill it, as `createdAt` does
    - reference another table with `.references(() => usersTable.id, { onDelete: "cascade" })`. Foreign keys are enforced

2. **Generate the migration.**

    ```bash
    bun run db:generate --name add_users_table
    ```

    This creates `src/db/migrations/<timestamp>_<name>/` containing `migration.sql` and `snapshot.json`. Commit both.

3. **Read the generated SQL.** SQLite cannot change most column properties in place, so drizzle-kit may rebuild a table to apply a change: it creates `__new_<table>`, copies the rows, drops the old table and renames the new one. Check that:
    - the `INSERT INTO ... SELECT` carries over every existing column
    - a new `NOT NULL` column has a default, or the rows that exist cannot be copied
    - no `ALTER TABLE ... ADD` adds a column whose default is an expression, such as the `strftime(...)` of `createdAt`. SQLite refuses that on a table that has rows, with `Cannot add a column with non-constant default`

    The tests migrate an empty database, so they pass even when a migration fails on a table with rows. To see what a migration does to real rows, start the server once before you generate it, add a few rows through the API, then generate the migration and start the server again.

    When the SQL is wrong, correct `migration.sql` before the migration reaches any other database, and say in a comment at its top what you changed. `src/db/migrations/20261009162607_kv_id_and_created_at/migration.sql` is an example: drizzle-kit added two columns with `ALTER TABLE ... ADD` and then rebuilt the table anyway, so the two statements were removed. Leave `snapshot.json` as it was generated.

4. **Update the seed** if the table needs default rows. Add `src/db/seeds/<table>.ts` following `src/db/seeds/kv.ts`, then add it to the list in `src/db/seeds/index.ts`, after any table it references.

5. **Update what uses the table**: routes, their schemas and tests.

6. **Verify** with `bun run check`. The tests apply every migration to a fresh database, so a migration with invalid SQL fails here. `test/migrations.test.ts` fails while the schema files hold a change that no migration covers.

## Renames

drizzle-kit cannot tell a rename from a drop followed by an add. Without a terminal it stops with exit code 2 and prints the hint it needs. Pass that hint back:

```bash
bun run db:generate --name rename_value_to_content \
    --hints '[{"type":"rename","kind":"column","from":["public","kv","value"],"to":["public","kv","content"]}]'
```

## Changing data instead of structure

To backfill or transform existing rows, generate an empty migration and write the SQL yourself:

```bash
bun run db:generate --custom --name backfill_user_roles
```

A custom migration is for data only. It records no change of structure, so a table or column that you create in it by hand stays unknown to drizzle-kit, and `bun run check` keeps reporting the schema files as changed.

## Foreign keys

The server enforces foreign keys, except while it applies migrations. They are off there because a rebuild drops the old table, and with `ON DELETE CASCADE` that would delete every row that references it.

A migration that deletes rows or drops a table therefore deletes nothing else. Remove or re-point the rows that reference them in the same migration.

## Rules

- Never edit or delete a migration that may have been applied to any database, including a deployed one. Applied migrations are recorded in the `__drizzle_migrations` table, and changing them leaves databases in a state the next migration does not expect. Add a new migration instead.
- A migration generated in the current task that has only touched your local database can be redone: delete its folder, delete `./data`, and generate again.
- Do not write migration folders or `snapshot.json` by hand. The exceptions are the SQL of a `--custom` migration and a correction to generated SQL as described in step 3.
- Seeds are inserted only while their table is empty. To change rows in existing databases, use a `--custom` migration.
