---
name: new-project
description: Steps for turning this Fastify template into a new API or app, covering renaming, replacing the example route and table, and resetting migrations. Use this once, at the start, when asked to create a project from this template or when the repository still contains the `/example` route.
---

# Start a new project from the template

The template runs as it is. Keep it running at every step: change one thing, then run `bun run check`.

## Steps

1. **Confirm the starting point works.**

    ```bash
    bun install
    bun run check
    ```

    A project unpacked from `bundle.tar.gz` has no `.claude/skills`, because the archive cannot hold a symlink. Create it again with `mkdir -p .claude && ln -s ../.agents/skills .claude/skills`.

2. **Name the project.** Set `name` in `package.json` and the matching `name` near the top of `bun.lock`, which Bun does not rewrite on its own. Rename the temporary directory prefix in `test/setup.ts` to match.

3. **Build the first real feature next to the example.** Follow [change-schema](../change-schema/SKILL.md) for its tables and [add-endpoint](../add-endpoint/SKILL.md) for its routes. Leave the example in place while you do, as a working reference.

4. **Remove the example** once a real table and route exist:
    - delete `src/routes/example.ts`, `test/example.test.ts`, `src/db/schema/kv.ts` and `src/db/seeds/kv.ts`
    - remove their lines from `src/routes/index.ts` and `src/db/seeds/index.ts`

5. **Reset the migrations to one initial migration.** This is only safe now, before the project has ever been deployed:

    ```bash
    rm -rf src/db/migrations data
    bun run db:generate --name init
    ```

    The project needs at least one migration, so do this after step 3, not before.

6. **Add the configuration the project needs** to `src/env.ts`, `.env.example`, `README.md` and, where the container needs it, `compose.yml`.

7. **Rewrite `README.md`** for the new project: what it does, its endpoints and its environment variables. Remove the sections that describe the template.

8. **Verify the result.**

    ```bash
    bun run check
    docker compose up --build --wait
    curl http://127.0.0.1:3000/health
    docker compose down
    ```

9. **Retire this playbook.** Delete `.agents/skills/new-project/` and its row in the playbook table of `AGENTS.md`, and update the first paragraph of `AGENTS.md` so it describes the project instead of the template.

## What to keep

Keep the structure, the scripts, the error handler, the `/health` route, the test setup and the Docker files. They are what the other playbooks and `AGENTS.md` describe.
