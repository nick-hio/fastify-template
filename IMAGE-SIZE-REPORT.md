# Fastify template Docker image size audit

Audit date: 11 October 2026. Baseline commit: `f71c784887150427c8c0463e8b1197d9cc270244`.

## Recommendation

**The default image now builds to 186.96 MB, down from 360.70 MB: a saving of 173.75 MB, or 48.2%.** I changed the base from Bun's Debian slim image to its Alpine image and excluded automatically installed peer dependencies from the production installation. The source layout, startup command, migrations, health check, live-backup command, and non-root operation are preserved.

For small applications with known dependencies, the tested **bundled Alpine variant reaches 132.31 MB, a 63.3% reduction**. It is a useful next step because its application layer is very small and the Bun runtime remains shareable across applications. I kept it as an explicit alternative rather than making every project created from the template inherit bundling constraints.

The results below come from building and running the images, not estimates from base-image advertisements.

| Variant | Local image disk usage | Unpacked snapshots¹ | Compressed content² | Reduction from baseline | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Original Debian slim + production dependencies | 360.70 MB | 272.91 MB | 87.80 MB | — | Baseline reproduced |
| Debian slim + omit automatic peers | 307.90 MB | 231.71 MB | 76.20 MB | 14.6% | Passed |
| **Alpine + omit automatic peers** | **186.96 MB** | **139.92 MB** | **47.04 MB** | **48.2%** | **Applied to the default Dockerfile** |
| Distroless + omit automatic peers | 198.66 MB | 150.55 MB | 48.11 MB | 44.9% | Server works; existing backup script fails |
| Alpine + omit peers + remove declarations/maps | 163.42 MB | 118.20 MB | 45.22 MB | 54.7% | Passed; kept as an experiment |
| **Alpine + bundled JavaScript** | **132.31 MB** | **89.66 MB** | **42.65 MB** | **63.3%** | **Passed; recommended optional optimization** |
| Distroless + bundled JavaScript | 144.01 MB | 100.29 MB | 43.71 MB | 60.1% | Server works; backup requires a direct command |
| Standalone executable + distroless OS | 147.30 MB | 103.50 MB | 43.80 MB | 59.2% | Passed with custom backup/health commands |

¹ Sum of Docker's per-layer snapshot sizes. ² Local image size minus that sum, matching Docker's displayed content size to the precision shown; includes small image metadata. MB means 1,000,000 bytes throughout.

## Baseline and measurement method

The measurements use Linux `amd64`, Bun **1.4.2**, the repository's frozen lockfile, Docker Engine **29.8.1**, and its containerd image store with the overlayfs snapshotter. No dependency versions were upgraded. Initial free disk space was approximately 147 GB.

This host's **361 MB includes both compressed image content and unpacked snapshots**. The original image's unpacked portion alone is about 273 MB. Docker documents that containerd retains both forms, so comparing this host's 361 MB with a registry download size or a legacy Docker image-store measurement would be misleading. [Docker: containerd disk usage](https://docs.docker.com/engine/storage/containerd/#disk-space-usage)

I measured image sizes with the Docker Engine API, inspected layer history and filesystem contents, and used `docker image ls --tree` and `docker system df -v` to check content and sharing. Image size excludes databases, backups, container logs, and build cache. The values are Docker's accounting, not a promise that removing one image will reclaim its full displayed size.

The starting Dockerfile already used a sensible multi-stage build, a separate production install, a dependency cache mount, and a strict `.dockerignore` allowlist. Tests, the repository history, host databases, and the development dependency directory were not being copied wholesale into the final image. Adding another generic multi-stage pattern would not solve the remaining overhead.

The original unpacked layers were approximately:

| Contributor | Size | What the audit found |
| --- | ---: | --- |
| Debian filesystem and certificate installation | 100.32 MB | Larger than this application's OS requirements |
| Bun executable | 79.52 MB | A substantial fixed cost even for a tiny application |
| Production `node_modules` | 92.74 MB | Included compiler/type packages, package metadata, alternate database integrations, and source maps |
| Source, configuration, users, and directories | 0.33 MB | Too small to be a useful optimization target |

Inside the production dependency tree, `du` showed roughly 27 MiB under `@typescript`, another 4 MiB for the `typescript` package, 4 MiB of Bun types, 26 MiB for Drizzle, and 9 MiB for Zod. These are rounded directory measurements and use different units from the layer table.

## Experiments and results

### 1. Stop automatically installing production peers

`bun install --production` excludes root development dependencies, but it does not automatically exclude peers. The lockfile and package manifests explain the surprise: `@t3-oss/env-core` declares TypeScript as an optional peer, and Drizzle declares `bun-types` as an optional peer. The production image therefore still contained tools and types the running service did not need. Bun documents both peer installation and the `--omit peer` option. [Bun install documentation](https://bun.com/docs/pm/cli/install)

Adding `--omit=peer` to **only the production install** reduced the dependency layer from **92.74 MB to 51.54 MB**. Total local image size fell by **52.80 MB**. The development/verification stage still installs the compiler, types, and migration tools normally.

Runtime peers such as Fastify and Zod remain installed because they are explicit `dependencies`. The change also omits automatically installed packages such as Swagger that this template does not use. Projects adding a plugin must explicitly list any peer packages they need at runtime. This is a dependency-management tradeoff, not a universal claim that peers are unnecessary.

### 2. Change the operating-system base

Using `oven/bun:1.4.2-alpine` with the same peer omission reduced the 307.90 MB image to **186.96 MB**, saving another **120.94 MB**. Both dependency installation and verification run on Alpine, so the build does not copy a production dependency installation from a different libc environment.

Alpine was the best tested default: it retained a shell and the existing operational commands while being smaller than distroless. Its Bun executable layer was also smaller: **73.49 MB**, versus **79.52 MB** in the Debian-based image.

Alpine uses musl rather than glibc. This template's current dependencies and Bun SQLite driver passed the tests, but a future application that adds a native addon or external binary needs to check musl support. Keeping Debian slim with `--omit=peer` remains a tested fallback at 307.90 MB. Only `amd64` was run in this audit; ARM64 was not tested.

### 3. Try distroless

The source-based distroless image measured **198.66 MB**, which was larger than Alpine. HTTP requests, SQLite, direct backups, HTTPS, and shutdown worked, but the documented command failed:

```text
bun run db:backup
error: An internal error occurred (MissingShell)
```

Running `bun src/db/backup.ts /data/backup.db` directly succeeded. The distroless experiments also use numeric UID/GID 1000 and Bun's filesystem API to prepare `/data`, because the original shell commands and named `bun` user cannot simply be assumed. Those operational changes bought no size advantage here, so I did not adopt distroless.

### 4. Remove declaration files and source maps

Deleting `*.map`, `*.d.ts`, `*.d.cts`, and `*.d.mts` from production dependencies **before copying them into the final image** brought Alpine down to **163.42 MB**. The container checks passed.

This saved another 23.54 MB of local disk usage, but most of the removed data compressed well: compressed content only fell by about 1.83 MB. I kept this as an experiment because it alters package contents and removes source-map debugging support. Deleting files in a later release-image layer would not remove their bytes from an earlier layer.

### 5. Bundle the actual runtime dependency graph

I used `bun build --target=bun --minify` for the server and backup entrypoints, then shipped the emitted JavaScript and migrations without `node_modules`. The server bundle was approximately **1.31 MB** and the backup bundle **82.51 KB** before image-layer accounting. The complete application copy layer was **1.46 MB unpacked**.

The Alpine result was **132.31 MB**, and the distroless result was **144.01 MB**. Bundling removes unused code and package files much more effectively than copying whole packages, particularly for Drizzle's many database integrations.

Two packaging details were necessary:

- The migration code resolves `../migrations` relative to its module. After bundling, the experimental image places the server under `app/` and migrations under the adjacent `migrations/` directory, preserving that relationship. The SQL files still need to exist on disk.
- The backup is a separate entrypoint. Its bundle and a small package manifest preserve `bun run db:backup` on Alpine. Bundling only the server would break that workflow.

The bundled images passed production-container checks. They do not contain the source files or development commands of the normal template image. Future filesystem assets, dynamic imports, native addons, or worker-based logging transports need explicit packaging and tests. No source maps were shipped in this experiment, so error-stack debugging is less convenient. These are the reasons bundling remains an optional recipe rather than the new default for an extensible template.

### 6. Compile a standalone executable

The compiled experiment used one executable with server, health-check, and backup modes, avoiding separate embedded runtimes for those commands. Migrations remained external; an experiment-only source adjustment resolved them from the container working directory. The release image used `gcr.io/distroless/base-nossl-debian13` and did not contain a second Bun executable.

It worked and measured **147.30 MB**, but its executable copy layer alone was **83.98 MB unpacked**. Bun compilation includes the runtime with the application, so it does not turn this JavaScript service into a tiny native program. [Bun standalone executable documentation](https://bun.com/docs/bundler/executables)

It was larger than the bundled Alpine image, required new operational commands (`server backup`, `server health`), and targeted x64 explicitly. A different application produces a different large executable layer, reducing sharing across applications. It was not a good fit for the stated goal of hosting many small services.

## Verification

The revised default passed **`bun run check`: typecheck, Biome lint/format checks, and 78 tests with 168 assertions**. The Alpine Docker build also passed the existing typecheck and 78-test verification stage. The original build gate remains in place.

I built and exercised eight image variants. Their container checks covered:

- HTTP health and Docker's actual configured health-check command.
- Applying both migrations to a fresh SQLite database and avoiding duplicate migration application on restart.
- Create, read, update, delete, cursor pagination, 400 validation, 409 conflicts, and 404 responses.
- A live database backup, SQLite integrity checking, and verifying the updated row in the backup.
- SIGTERM shutdown with the expected log message and exit status 0.
- Data persistence across container restarts.
- Non-root execution with the host UID/GID override, a read-only root filesystem, all capabilities dropped, and `no-new-privileges`.

For all seven images retaining the Bun CLI, additional probes checked outbound HTTPS/DNS and rejected writes to the application directory. The standalone image used the same restrictive container settings, but those two CLI probes were not run against it. The two distroless/Bun images passed using direct backup commands; their `bun run db:backup` failures are recorded explicitly, not counted as compatible behavior.

I also ran the **actual unchanged `compose.yml`** under an isolated project name with the revised Dockerfile: build, healthy startup, `/health`, `docker compose exec -T app bun run db:backup`, and backup integrity verification all passed. Its temporary container and network were then removed. A separate check confirmed the image's default UID 1000 can write its `/data` volume. No existing application's database was used.

The checked-in verification script was additionally run against the final `fastify-size-audit:recommended` image. These checks establish correctness for the current template; they are not a throughput benchmark, a security scan, or validation of every future plugin.

## Changes and tradeoffs

The production change is limited to [Dockerfile](Dockerfile):

```diff
-FROM oven/bun:${BUN_VERSION}-slim AS base
+FROM oven/bun:${BUN_VERSION}-alpine AS base

-    bun install --frozen-lockfile --production
+    bun install --frozen-lockfile --production --omit=peer
```

A comment explains that runtime peers must be explicit dependencies. Application source, database migrations, package versions, the lockfile, and Compose configuration were unchanged.

[audit/image-size](audit/image-size/) contains the original and experimental Dockerfiles, a reusable container-check script, a measurement script, and the recorded results. The existing `.dockerignore` keeps these audit artifacts out of image builds. They are audit snapshots of this template version, not additional maintained release configurations.

The default preserves source execution and operational simplicity at **186.96 MB**. For applications whose dependencies and assets are well understood, use the **132.31 MB bundled recipe** and rerun its container checks whenever runtime dependencies or asset handling change.

## Disk usage across many applications

**Ten containers do not necessarily consume ten full copies of the displayed image size.** Containers using the same image share its image layers; different applications also share identical base layers. Different image tags alone do not defeat that sharing. [Docker storage-driver documentation](https://docs.docker.com/engine/storage/drivers/)

The audit confirmed sharing in this environment. While the variants coexisted, `docker system df -v` reported approximately **130.48 MB shared and 1.83 MB unique** for the bundled Alpine image. A source-based Alpine image has approximately **56.48 MB of application/dependency data** beyond that common base. That dependency layer can also be shared when its contents and layer identity match; do not assume every project will produce an identical layer.

As an illustration, ten similarly sized bundled applications sharing that exact base would be roughly **130.48 + 10 × 1.83 ≈ 149 MB** of image data, before databases, logs, and build cache. This is an extrapolation from measured layers, not a ten-application deployment benchmark. The first bundled application still needs the full base; a small source file does not eliminate the Bun runtime.

This is why a shared Bun base plus small JavaScript bundles is attractive for the user's specific goal. Compiled executables combine runtime and application bytes into a large application-specific layer, so they generally lose that particular sharing advantage between different applications.

There was also **11.34 GB of build cache before this audit**, compared with 5.33 GB reported in the Images category. Those categories can overlap and should not be blindly added. Smaller release images do not erase build caches, old image versions, database backups, or container logs. I did not prune unrelated host resources. Matching Bun/base-image versions across applications improves sharing, while retained older versions can keep older layers alive.

After recording results, I removed the eight temporary experiment image tags, the two explicitly pulled Bun base tags, and all audit containers and networks. The final `fastify-size-audit:recommended` image remains available locally. BuildKit retains cache from the experiments: the host reported 12.40 GB afterward, approximately 1.06 GB above its starting value; this is a host-wide observation, not an isolated allocation measurement. I left the shared build cache intact. Small test databases and backups remain under the audit workload directory for inspection.

## Reproducing the measurements

Run from the repository root on a Docker-capable Linux host with Bun 1.4.2 and Python 3. The scripts use the local Docker daemon; the measurement script reads `/var/run/docker.sock`. The container checks create isolated test databases under `/home/t3svc/workloads/fastify-size-audit` and remove their temporary containers.

```bash
bun install --frozen-lockfile
bun run check

docker build -t fastify-size-audit:recommended .

for variant in baseline nopeer alpine distroless pruned-alpine bundled-alpine bundled-distroless compiled; do
    docker build \
        -f "audit/image-size/Dockerfile.$variant" \
        -t "fastify-size-audit:$variant" .
done

python3 audit/image-size/measure.py
python3 audit/image-size/smoke.py \
    baseline nopeer alpine distroless pruned-alpine \
    bundled-alpine bundled-distroless compiled recommended

docker image ls --filter 'reference=fastify-size-audit:*'
docker system df -v
```

Use [results/measurements.json](audit/image-size/results/measurements.json) for the recorded bytes and layer identities, `results/smoke-*.json` for individual checks and known limitations, and [check.txt](audit/image-size/results/check.txt) and [compose.txt](audit/image-size/results/compose.txt) for the final checks. The recipes use versioned base tags; tags and build tooling can change, so later results may differ. The compiled recipe is intentionally x64-specific.

The pulled Bun base-image index digests were:

- Alpine: `sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f`.
- Distroless: `sha256:1a0c31c7c5f9d193aedf60fe1cebdeb76ac8f6e29f24be8dd8cbd6df72df26ec`.

The baseline Bun slim digest was `sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61`; the compiled image's distroless OS digest was `sha256:af5cb8dd589b8520b8c06bebb9efb73d7e16406cab58e85c51761fff49d370a0`.
