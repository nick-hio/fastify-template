---
name: docker-image
description: Steps for building, running and changing this project's Docker image and Compose stack, including the data volume, health check and file permissions. Use this when touching the Dockerfile, .dockerignore or compose.yml, when the container fails to start, or when asked to deploy or verify the image.
---

# Docker image

## Build and verify

```bash
docker compose up --build --wait          # build, start, wait for the health check
curl http://127.0.0.1:3000/health         # {"status":"ok"}
docker compose logs app                   # server logs, one JSON object per line
docker compose down                       # stop; add --volumes to delete the database too
```

`APP_PORT` sets the published host port (`APP_PORT=8080 docker compose up ...`). Inside the container the server always listens on 3000.

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
- **New environment variables.** Add them under `environment` in `compose.yml` when the container needs a value other than the default.
- **Bun version.** Change `BUN_VERSION` in the `Dockerfile` and `packageManager` in `package.json` together.
- **Health check.** The image polls `GET /health`. Keep that route cheap and free of authentication.

## Data and permissions

The SQLite database is `/data/database.db`. Without a volume on `/data`, it is lost when the container is removed.

- A named volume (`-v my-app-data:/data`, as in `compose.yml`) works as is.
- A bind mount must be writable by the container user. Either give the host directory to uid 1000, or run the container as the directory's owner with `--user "$(id -u):$(id -g)"` (`user:` in Compose).

If the directory is not writable, the server exits at startup with `Unable to open the database in '/data'`.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Build fails in the `verify` stage | A type error or failing test. Reproduce with `bun run check` |
| Build fails with a missing file | The path is not allowed in `.dockerignore` |
| `Unable to open the database in '/data'` | The mounted directory belongs to a different user, see above |
| `Environment variable(s) failed validation` | A value does not match `src/env.ts`. In list-form `environment:` entries, quotes become part of the value |
| Container is `unhealthy` | `GET /health` does not return 200. Check `docker compose logs app` |
