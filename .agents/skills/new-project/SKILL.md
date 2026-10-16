---
name: new-project
description: Steps for turning this Fastify template into a new API or app, covering renaming, replacing the example route and table, and resetting migrations. Use this once, at the start, when asked to create a project from this template or when the repository still has the `/example` route.
---

# Start a new project from the template

The template runs as it is. Keep it running: change one thing, then run `bun run check`.

## Steps

1. **Check the starting point.**

    ```bash
    bun install
    bun run check
    ```

    A project from `bundle.tar.gz` has no `.claude/skills`, because the archive cannot hold a symlink. Create it: `mkdir -p .claude && ln -s ../.agents/skills .claude/skills`.

2. **Name the project.**
    - Set `name` in `package.json`.
    - Set the matching `name` near the top of `bun.lock`. Bun does not rewrite it.
    - Rename the temporary directory prefix in `test/setup.ts`.

3. **Build the first real feature next to the example.** Use [change-schema](../change-schema/SKILL.md) for its tables and [add-endpoint](../add-endpoint/SKILL.md) for its routes. Keep the example as a working reference until then.

4. **Remove the example** once a real table and route exist:
    - Delete `src/routes/example.ts`, `test/example.test.ts`, `src/db/schema/kv.ts` and `src/db/seeds/kv.ts`.
    - Remove their lines from `src/routes/index.ts` and `src/db/seeds/index.ts`.
    - Set `BODY_ROUTE` in `test/process.test.ts` to one of your routes that reads a JSON body.

5. **Reset the migrations to one initial migration.** This is safe only now, before the first deploy:

    ```bash
    rm -rf src/db/migrations data
    bun run db:generate --name init
    ```

    The project needs at least one migration, so do this after step 3, not before.

6. **Add the configuration the project needs** to `src/env.ts`, `.env.example`, `README.md` and, if the container needs it, `compose.yml`.

7. **Rewrite `README.md`** for the project: what it does, its endpoints, its environment variables. Remove the sections about the template.

8. **Verify.**

    ```bash
    bun run check
    mkdir -p data
    docker compose up --build --wait
    curl http://127.0.0.1:3000/health
    docker compose down
    ```

    Container unhealthy with `Unable to open the database in '/data'`? Your user is not uid 1000. Start it with `CONTAINER_USER="$(id -u):$(id -g)"`. See [docker-image](../docker-image/SKILL.md).

9. **Retire this playbook.**
    - Delete `.agents/skills/new-project/`.
    - Delete its row in the playbook table of `AGENTS.md`.
    - Rewrite the intro of `AGENTS.md` to describe the project, not the template.

## What to keep

- The structure and the scripts
- The error handler and the `/health` route
- The backup command and the Docker files
- Every test file except `test/example.test.ts`

`AGENTS.md` and the playbooks describe them, and the tests cover them.
