# Fastify Template

A starting point for HTTP APIs, built to be handed to an AI agent or picked up by a developer.

- [Fastify 5](https://fastify.dev) on the [Bun](https://bun.sh) runtime, written in TypeScript
- SQLite through [Drizzle ORM](https://orm.drizzle.team) and Bun's built-in driver, with generated migrations applied at startup and a backup command
- [Zod](https://zod.dev) schemas that validate requests, shape responses and type the handlers
- Tests, lint and typecheck behind one command
- A Docker image that runs as a non-root user and reports its health, plus a Compose file

## Quick start

Requires [Bun](https://bun.sh). The template is developed and tested with Bun 1.4.

```bash
bun install
bun run dev
```

The server listens on <http://localhost:3000> and keeps its database in `./data`.

```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/example -H 'content-type: application/json' -d '{"key":"greeting","value":"hello"}'
curl http://localhost:3000/example
```

To change the defaults, copy `.env.example` to `.env`.

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Start the server and reload on change |
| `bun run start` | Start the server |
| `bun run check` | Typecheck, lint and test |
| `bun test` | Run the tests against a temporary database |
| `bun run typecheck` | Typecheck with `tsc` |
| `bun run lint` | Check lint rules and formatting with Biome |
| `bun run format` | Fix formatting, import order and safe lint issues |
| `bun run db:generate --name <change>` | Generate a migration from `src/db/schema` |
| `bun run db:studio` | Browse the database with Drizzle Studio |
| `bun run db:backup [file]` | Copy the database to a file, see [Backup and restore](#backup-and-restore) |
| `bun run bundle` | Pack the template into `bundle.tar.gz` |

## Environment Variables

Every variable is optional.

| Key | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `"production"` | `"development"`, `"production"` or `"test"`. `bun run dev` sets `"development"` |
| `LOG_LEVEL` | `"info"` | `"fatal"`, `"error"`, `"warn"`, `"info"`, `"debug"`, `"trace"` or `"silent"` |
| `APP_HOST` | `"0.0.0.0"` | IPv4 address the server binds to |
| `APP_PORT` | `3000` | Port the server listens on |
| `DATA_DIR` | `"./data"` | Directory that holds the SQLite database. The Docker image sets it to `/data` |
| `TRUST_PROXY` | `false` | The reverse proxies in front of the server, as a comma-separated list of IPv4 addresses and CIDR ranges, such as `"127.0.0.1"` or `"172.16.0.0/12"`. The server takes the client address, host and protocol from the `X-Forwarded-*` headers of requests that they send, and from no one else. Name the proxies and nothing more: a client can write these headers too |
| `REQUEST_TIMEOUT_MS` | `30000` | A request that has no response after this many milliseconds is answered with 503 |
| `SHUTDOWN_TIMEOUT_MS` | `8000` | On shutdown, how many milliseconds the server waits for open requests before it exits anyway. Keep it below the stop timeout of whatever runs the server, which is 10 seconds for Docker |

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Returns `{"status":"ok"}` when the server and database respond |
| `GET` | `/example` | Lists the entries, a page at a time. `limit` sets the page size (default 20, at most 100) |
| `POST` | `/example` | Creates an entry from `{"key": "...", "value": "..."}` and returns it with 201. A key that exists is a 409 |
| `GET` | `/example/:id` | Returns one entry |
| `PATCH` | `/example/:id` | Changes the value of an entry to `{"value": "..."}` and returns the entry |
| `DELETE` | `/example/:id` | Deletes an entry and returns 204 without a body |

An entry looks like `{"id": 1, "key": "greeting", "value": "hello", "createdAt": "2026-01-31T12:00:00.000Z"}`.

A list is `{"items": [...], "nextCursor": 20}`. Pass `nextCursor` as `cursor` to get the next page: `/example?cursor=20`. On the last page it is `null`.

Errors use one shape: `{"statusCode": 404, "error": "Not Found", "message": "Entry Not Found"}`. A request that fails validation is a 400 that also names each invalid field:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Invalid Request Body",
  "issues": [{ "path": "value", "message": "Invalid input: expected string, received undefined" }]
}
```

The `/example` route and its `kv` table show how routes, schemas, migrations and tests fit together. Replace them with your own.

## Database

The database is one SQLite file, `database.db` in `DATA_DIR`. The migrations in `src/db/migrations` are applied when the server starts.

SQLite runs in [write-ahead logging](https://www.sqlite.org/wal.html) mode, so a backup or another process can read the database while the server writes to it. While the server runs, two more files sit next to the database: `database.db-wal` and `database.db-shm`. They are part of it. Keep `DATA_DIR` on a local disk, because write-ahead logging does not work on a network file system.

### Backup and restore

```bash
bun run db:backup                          # writes ./data/backups/database-<time>.db
bun run db:backup /mnt/backups/app.db      # or to a file of your choice
```

The command is safe while the server runs. It writes one complete file, checks that the copy is intact and never overwrites an existing file. Do not copy `database.db` by hand instead: the newest changes are still in `database.db-wal`, so the copy would miss them.

Backups in `DATA_DIR` are on the same disk as the database. Run the command on a schedule and move the files to another machine.

To restore a backup, stop the server, put the file in place of the database and start the server again:

```bash
cp data/backups/database-<time>.db data/database.db
rm -f data/database.db-wal data/database.db-shm
```

The second command removes what is left of the old write-ahead log. SQLite could otherwise replay it on top of the restored file.

## Working with AI agents

- [AGENTS.md](AGENTS.md) describes the commands, layout and conventions. Most coding agents read it automatically. `CLAUDE.md` imports it for Claude Code.
- [.agents/skills/](.agents/skills) holds step-by-step playbooks for the common tasks: starting a new project, adding an endpoint, changing the database schema and working on the Docker image. `.claude/skills` is a symlink to it, so Claude Code loads the same playbooks as skills.
- The same directory has playbooks for what the template leaves out on purpose, because each project needs it differently: authentication, OpenAPI documentation, CORS, security headers, rate limiting, metrics, an MCP server and publishing the Docker image. [AGENTS.md](AGENTS.md#playbooks) lists them all.
- `bun run check` is the single command an agent runs to confirm a change.
- `bun run bundle` writes `bundle.tar.gz` with everything a new project needs, for agents that take a file upload instead of a repository. The archive leaves out the `.claude/skills` symlink.

> On Windows, Git only creates the symlink when symlink support is on: enable Developer Mode and clone with `git clone -c core.symlinks=true`. Otherwise `.claude/skills` is checked out as a text file.

## Docker

### Docker Compose

```bash
mkdir -p data
docker compose up --build --wait
```

This builds the image, starts the server on port 3000 and keeps the database in `./data` on the host.

Compose reads these variables from the environment or from `.env`:

| Key | Default | Description |
| --- | --- | --- |
| `APP_PORT` | `3000` | Host port the server is published on |
| `DATA_DIR` | `./data` | Host directory that holds the database. It must exist before the first start |
| `CONTAINER_USER` | `1000:1000` | User and group id the server runs as. It must own `DATA_DIR` |
| `LOG_LEVEL`, `TRUST_PROXY`, `REQUEST_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS` | | Passed on to the server, see [Environment Variables](#environment-variables) |

The server runs as uid 1000 and must be able to write to `DATA_DIR`. When `id -u` prints another number for you, the directory you created belongs to that user and the server fails with `Unable to open the database in '/data'`. Run the container as yourself instead:

```bash
CONTAINER_USER="$(id -u):$(id -g)" docker compose up --build --wait
```

To back up and restore the database of a running stack:

```bash
docker compose exec app bun run db:backup      # writes ./data/backups/database-<time>.db on the host

docker compose down
cp data/backups/database-<time>.db data/database.db
rm -f data/database.db-wal data/database.db-shm
docker compose up --wait
```

### Docker Run

```bash
docker build --tag app-name:0.1.0 .
docker run -d --name my-app -p 3000:3000 -v my-app-data:/data app-name:0.1.0
```

> Add `--platform linux/amd64` to the build when the image is built on an ARM machine, such as an Apple Silicon Mac, and deployed to an x86 server.

### Data

The database lives in `/data` inside the container. Mount a volume or a host directory there, or it is lost when the container is removed.

The server runs as a non-root user (uid 1000). A named volume, as in the command above, works as is. To mount a host directory instead, run the container as the owner of that directory:

```bash
docker run -d --name my-app -p 3000:3000 --user "$(id -u):$(id -g)" -v "/path/to/data:/data" app-name:0.1.0
```

On Windows, mount the directory as `-v "C:/path/to/data:/data"` and leave out `--user`.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`. It runs `bun run check`, then builds the Docker image, starts it with Compose and takes a backup inside the container.

## License

[MIT](LICENSE)
