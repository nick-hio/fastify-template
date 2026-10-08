# Fastify Template

A starting point for HTTP APIs, built to be handed to an AI agent or picked up by a developer.

- [Fastify 5](https://fastify.dev) on the [Bun](https://bun.sh) runtime, written in TypeScript
- SQLite through [Drizzle ORM](https://orm.drizzle.team), with generated migrations applied at startup
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
curl 'http://localhost:3000/example?key=greeting'
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
| `bun run bundle` | Pack the template into `bundle.tar.gz` |

## Environment Variables

Every variable is optional.

| Key | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `"production"` | `"development"`, `"production"` or `"test"`. `bun run dev` sets `"development"` |
| `LOG_LEVEL` | `"info"` | `"fatal"`, `"error"`, `"warn"`, `"info"`, `"debug"`, `"trace"` or `"silent"` |
| `APP_HOST` | `"0.0.0.0"` | Address the server binds to |
| `APP_PORT` | `3000` | Port the server listens on |
| `DATA_DIR` | `"./data"` | Directory that holds the SQLite database. The Docker image sets it to `/data` |
| `TRUST_PROXY` | `false` | Read the client IP from `X-Real-IP` / `X-Client-IP`. Enable only when every request passes through a reverse proxy that sets them |

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Returns `{"status":"ok"}` when the server and database respond |
| `GET` | `/example?key=<key>` | Returns the entry stored under `key` |
| `POST` | `/example` | Stores `{"key": "...", "value": "..."}`, replacing any existing value |
| `DELETE` | `/example?key=<key>` | Deletes the entry and returns it |

Errors use one shape: `{"statusCode": 404, "error": "Not Found", "message": "Key Not Found"}`.

The `/example` route and its `kv` table show how routes, schemas, migrations and tests fit together. Replace them with your own.

## Working with AI agents

- [AGENTS.md](AGENTS.md) describes the commands, layout and conventions. Most coding agents read it automatically. `CLAUDE.md` imports it for Claude Code.
- [.claude/skills/](.claude/skills) holds step-by-step playbooks for starting a new project, adding an endpoint, changing the database schema and working on the Docker image.
- `bun run check` is the single command an agent runs to confirm a change.
- `bun run bundle` writes `bundle.tar.gz` with everything a new project needs, for agents that take a file upload instead of a repository.

## Docker

### Docker Compose

```bash
docker compose up --build --wait
```

This builds the image, starts the server on port 3000 and stores the database in a named volume. Set `APP_PORT` to publish a different host port and `LOG_LEVEL` to change the log level.

### Docker Run

```bash
docker build --tag app-name:0.1.0 .
docker run -d --name my-app -p 3000:3000 -v my-app-data:/data app-name:0.1.0
```

> Add `--platform linux/amd64` to the build when the image is built on an ARM machine, such as an Apple Silicon Mac, and deployed to an x86 server.

### Data

The database lives in `/data` inside the container. Mount a volume there, or it is lost when the container is removed.

The server runs as a non-root user (uid 1000). A named volume works as is. To mount a host directory instead, run the container as the owner of that directory:

```bash
docker run -d --name my-app -p 3000:3000 --user "$(id -u):$(id -g)" -v "/path/to/data:/data" app-name:0.1.0
```

On Windows, mount the directory as `-v "C:/path/to/data:/data"` and leave out `--user`.

## Continuous integration

`.github/workflows/ci.yml` runs `bun run check` and builds and starts the Docker image on every pull request and on pushes to `main`.

## License

[MIT](LICENSE)
