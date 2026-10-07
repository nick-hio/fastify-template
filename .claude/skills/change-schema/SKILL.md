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
    - export the inferred TypeScript type

2. **Generate the migration.**

    ```bash
    bun run db:generate --name add_users_table
    ```

    This creates `src/db/migrations/<timestamp>_<name>/` containing `migration.sql` and `snapshot.json`. Commit both.

3. **Read the generated SQL.** SQLite cannot change most column properties in place, so drizzle-kit may recreate a table to apply a change. Check that existing rows are carried over and that a new `NOT NULL` column has a default.

4. **Update the seed** if the table needs default rows. Add `src/db/seeds/<table>.ts` following `src/db/seeds/kv.ts`, then add it to the list in `src/db/seeds/index.ts`, after any table it references.

5. **Update what uses the table**: routes, their schemas and tests.

6. **Verify** with `bun run check`. The tests apply every migration to a fresh database, so a broken migration fails here.

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

## Rules

- Never edit or delete a migration that may have been applied to any database, including a deployed one. Applied migrations are recorded in the `__drizzle_migrations` table, and changing them leaves databases in a state the next migration does not expect. Add a new migration instead.
- A migration generated in the current task that has only touched your local database can be redone: delete its folder, delete `./data`, and generate again.
- Do not write migration folders or `snapshot.json` by hand, apart from the SQL in a `--custom` migration.
- Seeds are inserted only while their table is empty. To change rows in existing databases, use a `--custom` migration.
