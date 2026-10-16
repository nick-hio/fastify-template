---
name: docker-image
description: Steps for building, running and changing this project's Docker image and Compose stack, including the data directory, backups, health check and file permissions. Use this when touching the Dockerfile, .dockerignore or compose.yml, when the container fails to start, or when asked to deploy, back up or verify the image.
---

# Docker image

## Build and verify

```bash
mkdir -p data                             # the database directory, see "Data and permissions"
docker compose up --build --wait          # build, start, wait for the health check
curl http://127.0.0.1:3000/health         # {"status":"ok"}
docker compose logs app                   # server logs, one JSON object per line
docker compose down                       # stop; the database stays in ./data
```

Compose reads three settings of its own from the environment or from `.env`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `APP_PORT` | `3000` | Published host port. Inside the container the server always listens on 3000 |
| `DATA_DIR` | `./data` | Host directory mounted at `/data` |
| `CONTAINER_USER` | `1000:1000` | User and group id the server runs as |

The `verify` stage typechecks and runs the tests, so a failing check fails the build. Read the build output before you change the Dockerfile.

## Stages

| Stage | Purpose |
| --- | --- |
| `deps` | All dependencies. Cached until `package.json` or `bun.lock` change |
| `prod-deps` | Production dependencies only |
| `verify` | Copies the build context, runs `bun run typecheck` and `bun test` |
| `release` | Final image: production `node_modules`, `src/`, `package.json`, `tsconfig.json` |

There is no compile step. Bun runs the TypeScript in `src/` directly, as the non-root user `bun` (uid 1000).

## Rules when changing it

- **Files the build needs.** `.dockerignore` ignores everything except an allowlist. Add `!<path>` for a new top-level file or directory.
- **Files the server needs at runtime.** The `release` stage copies only `src/`. Anything else, such as static assets, needs a `COPY --from=verify` line there.
- **Writable paths.** `compose.yml` mounts the root filesystem read-only. The server can write only under `/data` (`DATA_DIR`). If a library needs a temp directory, add `tmpfs: [/tmp]` to the service.
- **Environment variables.** Add each one under `environment` in `compose.yml` as `NAME: ${NAME:-}`.
    - Compose does not pass `.env` to the container. A variable without this line never reaches the server.
    - An empty value makes the server use the default from `src/env.ts`.
- **Shutdown.** Docker sends SIGTERM, then kills the container 10 seconds later. The server stops waiting for open requests after `SHUTDOWN_TIMEOUT_MS` (default 8 seconds). If you raise it, set a longer `stop_grace_period` on the service.
- **Bun version.** Change `BUN_VERSION` in the `Dockerfile` and `packageManager` in `package.json` together.
- **Health check.** The image polls `GET /health`. Keep that route cheap and without authentication.

## Data and permissions

The database is `/data/database.db`, plus `database.db-wal` and `database.db-shm` while the server runs. Without a mount on `/data`, it is lost when the container is removed. `compose.yml` mounts the host directory `DATA_DIR` there.

- **The directory must exist.** Compose does not create it: Docker would create it as root, and the server could not write to it. Run `mkdir -p data` once.
- **The directory must belong to the container's user** (uid 1000 by default). If `id -u` prints another number, start the stack with `CONTAINER_USER="$(id -u):$(id -g)"`, or put it in `.env`.
- **A named volume** (`-v my-app-data:/data` with `docker run`) needs neither. Docker gives it to the user of the image.

If the directory is not writable, the server exits at startup with `Unable to open the database in '/data'`.

## Backup and restore

```bash
docker compose exec app bun run db:backup      # writes <DATA_DIR>/backups/database-<time>.db
```

Safe while the server runs. Never `cp` the `database.db` of a running stack: the newest changes are in `database.db-wal`.

To restore, stop the stack first:

```bash
docker compose down
cp data/backups/database-<time>.db data/database.db
rm -f data/database.db-wal data/database.db-shm      # what is left of the old write-ahead log
docker compose up --wait
```

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Build fails in the `verify` stage | A type error or a failing test. Reproduce with `bun run check` |
| Build fails with a missing file | `.dockerignore` does not allow the path |
| `bind source path does not exist` | The host directory `DATA_DIR` is missing. Create it with `mkdir -p data` |
| `Unable to open the database in '/data'` | The mounted directory belongs to another user. Set `CONTAINER_USER`, see above |
| A variable from `.env` has no effect in the container | It is not under `environment` in `compose.yml` |
| `Environment variable(s) failed validation` | A value does not match `src/env.ts`. In list-form `environment:` entries, quotes become part of the value |
| Container is `unhealthy` | `GET /health` does not return 200. Check `docker compose logs app` |
