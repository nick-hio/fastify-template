# Fastify Template

A starting point for HTTP APIs, for an AI agent or a developer to pick up.

- [Fastify 5](https://fastify.dev) on the [Bun](https://bun.sh) runtime, in TypeScript
- SQLite through [Drizzle ORM](https://orm.drizzle.team), with migrations at startup and a backup command
- [Zod](https://zod.dev) schemas that validate requests, shape responses and type handlers
- Tests, lint and typecheck in one command
- A Docker image that runs as non-root and reports its health, plus a Compose file

## Quick start

Requires [Bun](https://bun.sh). Tested with Bun 1.4.

```bash
bun install
bun run dev
```

The server listens on <http://localhost:3000>. The database is in `./data`.

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
| `bun run db:backup [file]` | Copy the database to a file. See [Backup and restore](#backup-and-restore) |
| `bun run bundle` | Pack the template into `bundle.tar.gz` |

## Environment variables

All variables are optional.

| Key | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `"production"` | `"development"`, `"production"` or `"test"`. `bun run dev` sets `"development"` |
| `LOG_LEVEL` | `"info"` | `"fatal"`, `"error"`, `"warn"`, `"info"`, `"debug"`, `"trace"` or `"silent"` |
| `APP_HOST` | `"0.0.0.0"` | Listen address: an IPv4 address, an IPv6 address or `"localhost"`. See below |
| `APP_PORT` | `3000` | Listen port |
| `DATA_DIR` | `"./data"` | Directory for the SQLite database. The Docker image sets it to `/data` |
| `TRUST_PROXY` | `false` | Reverse proxies in front of the server: comma-separated IP addresses and CIDR ranges. See below |
| `REQUEST_TIMEOUT_MS` | `30000` | Answer 503 when a request has no response after this many milliseconds |
| `SHUTDOWN_TIMEOUT_MS` | `8000` | On shutdown, the longest wait in milliseconds for open requests. Keep it below the runner's stop timeout (Docker: 10 seconds) |

**`APP_HOST`**

- `"0.0.0.0"` is every IPv4 address.
- `"::"` is every IPv6 address. On Linux it is every IPv4 address too. An IPv4 client then has an address like `::ffff:203.0.113.7`.

**`TRUST_PROXY`**

- Examples: `"127.0.0.1"`, `"172.16.0.0/12"`, `"fd00::/8"`.
- The server reads the client address, host and protocol from the `X-Forwarded-*` headers of these proxies only.
- List the proxies and nothing more. Clients can write these headers too.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | `{"status":"ok"}` when the server and database respond |
| `GET` | `/example` | List the entries, one page at a time. `limit` sets the page size (default 20, max 100) |
| `POST` | `/example` | Create an entry from `{"key": "...", "value": "..."}`. Returns it with 201. An existing key is a 409 |
| `GET` | `/example/:id` | Get one entry |
| `PATCH` | `/example/:id` | Set the value of an entry from `{"value": "..."}`. Returns the entry |
| `DELETE` | `/example/:id` | Delete an entry. Returns 204 with no body |

**Entry:** `{"id": 1, "key": "greeting", "value": "hello", "createdAt": "2026-01-31T12:00:00.000Z"}`

**List:** `{"items": [...], "nextCursor": 20}`. Pass `nextCursor` as `cursor` to get the next page: `/example?cursor=20`. It is `null` on the last page.

**Error:** `{"statusCode": 404, "error": "Not Found", "message": "Entry Not Found"}`. A validation failure is a 400 that also names each invalid field:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Invalid Request Body",
  "issues": [{ "path": "value", "message": "Invalid input: expected string, received undefined" }]
}
```

`/example` and its `kv` table show how routes, schemas, migrations and tests fit together. Replace them with your own.

## Database

- **One SQLite file:** `database.db` in `DATA_DIR`.
- **Migrations** in `src/db/migrations` are applied when the server starts.
- **[Write-ahead logging](https://www.sqlite.org/wal.html) (WAL).** A backup or another process can read the database while the server writes to it.
- **Three files.** While the server runs, `database.db-wal` and `database.db-shm` are part of the database.
- **Local disk only.** WAL does not work on a network file system.

### Backup and restore

```bash
bun run db:backup                          # writes ./data/backups/database-<time>.db
bun run db:backup /mnt/backups/app.db      # or to a file of your choice
```

- Safe while the server runs.
- Writes one complete file, checks it, and never overwrites a file.
- Do not copy `database.db` by hand. The copy would miss the newest changes in `database.db-wal`.
- Backups in `DATA_DIR` share a disk with the database. Run the command on a schedule and move the files to another machine.

To restore, stop the server, replace the database, then start the server again:

```bash
cp data/backups/database-<time>.db data/database.db
rm -f data/database.db-wal data/database.db-shm   # else SQLite can replay the old log onto the restored file
```

## Working with AI agents

- **[AGENTS.md](AGENTS.md)**: commands, layout and conventions. Most coding agents read it automatically. `CLAUDE.md` imports it for Claude Code.
- **[.agents/skills/](.agents/skills)**: step-by-step playbooks, listed in [AGENTS.md](AGENTS.md#playbooks).
    - Common tasks: new project, new endpoint, schema change, Docker image.
    - Optional features the template leaves out: OpenAPI, CORS, security headers, rate limiting, metrics, an MCP server, publishing the image.
- **`.claude/skills`**: a symlink to `.agents/skills`, so Claude Code loads the same playbooks.
- **`bun run check`**: the one command an agent runs to confirm a change.
- **`bun run bundle`**: writes `bundle.tar.gz`, for agents that take a file upload instead of a repository. It leaves out the `.claude/skills` symlink.

> On Windows, Git creates the symlink only with symlink support on. Enable Developer Mode and clone with `git clone -c core.symlinks=true`. Otherwise `.claude/skills` is a text file.

## Docker

### Docker Compose

```bash
mkdir -p data
docker compose up --build --wait
```

This builds the image and starts the server on port 3000. The database stays in `./data` on the host.

Compose reads these variables from the environment or from `.env`:

| Key | Default | Description |
| --- | --- | --- |
| `APP_PORT` | `3000` | Host port the server is published on |
| `DATA_DIR` | `./data` | Host directory for the database. It must exist before the first start |
| `CONTAINER_USER` | `1000:1000` | User and group id the server runs as. It must own `DATA_DIR` |
| `LOG_LEVEL`, `TRUST_PROXY`, `REQUEST_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS` | | Passed to the server. See [Environment variables](#environment-variables) |

**Permissions.** The server runs as uid 1000 and must write to `DATA_DIR`. If `id -u` prints another number, it fails with `Unable to open the database in '/data'`. Run the container as yourself:

```bash
CONTAINER_USER="$(id -u):$(id -g)" docker compose up --build --wait
```

**Backup and restore** for a running stack:

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

- **Mount `/data`.** The database lives there. Without a mount, it is lost when the container is removed.
- **Named volume:** works as is, as above.
- **Host directory:** the server runs as uid 1000, so run the container as the directory's owner:

    ```bash
    docker run -d --name my-app -p 3000:3000 --user "$(id -u):$(id -g)" -v "/path/to/data:/data" app-name:0.1.0
    ```

- **Windows:** mount the directory as `-v "C:/path/to/data:/data"` and leave out `--user`.
- **ARM to x86:** building on an ARM machine, such as an Apple Silicon Mac, for an x86 server? Add `--platform linux/amd64` to the build.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:

1. `bun run check`
2. Build the Docker image and start it with Compose
3. Take a backup inside the container

## License

[MIT](LICENSE)
