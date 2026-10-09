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

Compose takes three settings of its own from the environment or from `.env`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `APP_PORT` | `3000` | The published host port. Inside the container the server always listens on 3000 |
| `DATA_DIR` | `./data` | The host directory mounted at `/data` |
| `CONTAINER_USER` | `1000:1000` | The user and group id the server runs as |

The build typechecks the project and runs the tests in the `verify` stage, so a failing check fails the build. Read the build output before changing the Dockerfile.

## How the image is put together

| Stage | Purpose |
| --- | --- |
| `deps` | All dependencies, cached until `package.json` or `bun.lock` change |
| `prod-deps` | Production dependencies only |
| `verify` | Copies the build context, runs `bun run typecheck` and `bun test` |
| `release` | Final image: production `node_modules`, `src/`, `package.json`, `tsconfig.json` |

The server runs the TypeScript in `src/` directly with Bun, as the non-root user `bun` (uid 1000). There is no compile step.

## Rules when changing it

- **New files the build needs.** `.dockerignore` ignores everything except an allowlist. Add `!<path>` for a new top-level file or directory.
- **New files the server needs at runtime.** The `release` stage copies only `src/`. Anything else (static assets, templates) also needs a `COPY --from=verify` line there.
- **Writable paths.** `compose.yml` runs with a read-only root filesystem. The server may write only under `/data` (`DATA_DIR`). If a library needs a temp directory, add `tmpfs: [/tmp]` to the service.
- **New environment variables.** Add each one under `environment` in `compose.yml` as `NAME: ${NAME:-}`. Compose passes nothing from `.env` to the container on its own, so a variable that is missing there never reaches the server. An empty value makes the server use the default from `src/env.ts`.
- **Shutdown.** Docker sends SIGTERM and kills the container 10 seconds later. The server gives up waiting for open requests after `SHUTDOWN_TIMEOUT_MS`, 8 seconds by default. When you raise it, set `stop_grace_period` on the service to a longer time.
- **Bun version.** Change `BUN_VERSION` in the `Dockerfile` and `packageManager` in `package.json` together.
- **Health check.** The image polls `GET /health`. Keep that route cheap and free of authentication.

## Data and permissions

The SQLite database is `/data/database.db`, with `database.db-wal` and `database.db-shm` next to it while the server runs. Without a mount on `/data`, it is lost when the container is removed.

`compose.yml` mounts the host directory `DATA_DIR` there, so the database is an ordinary file on the host.

- **The directory must exist.** Compose does not create it, because Docker would create it as root and the server could not write to it. Run `mkdir -p data` once.
- **The directory must belong to the user of the container.** That is uid 1000 by default. When `id -u` prints another number, start the stack with `CONTAINER_USER="$(id -u):$(id -g)"`, or put that value in `.env`.
- **A named volume** (`-v my-app-data:/data` with `docker run`) needs neither. Docker gives it to the user of the image.

If the directory is not writable, the server exits at startup with `Unable to open the database in '/data'`.

## Backup and restore

```bash
docker compose exec app bun run db:backup      # writes <DATA_DIR>/backups/database-<time>.db
```

The command is safe while the server runs. Never copy `database.db` out of a running stack with `cp`: the newest changes are in `database.db-wal`.

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
| Build fails in the `verify` stage | A type error or failing test. Reproduce with `bun run check` |
| Build fails with a missing file | The path is not allowed in `.dockerignore` |
| `bind source path does not exist` | The host directory `DATA_DIR` is missing. Create it with `mkdir -p data` |
| `Unable to open the database in '/data'` | The mounted directory belongs to a different user. Set `CONTAINER_USER`, see above |
| A variable from `.env` has no effect in the container | It is not listed under `environment` in `compose.yml` |
| `Environment variable(s) failed validation` | A value does not match `src/env.ts`. In list-form `environment:` entries, quotes become part of the value |
| Container is `unhealthy` | `GET /health` does not return 200. Check `docker compose logs app` |
