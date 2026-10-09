import { expect, test } from "bun:test";
import { $ } from "bun";

test("the migrations are up to date with the schema files", async () => {
    // A dry run: it reports the migration that `db:generate` would write, without writing it.
    const pending = await $`bun --bun drizzle-kit generate --explain --output json`.json();

    expect(
        pending,
        "src/db/schema has changes without a migration. Run `bun run db:generate --name <change>` and commit the result.",
    ).toEqual({ status: "no_changes", dialect: "sqlite" });
});
