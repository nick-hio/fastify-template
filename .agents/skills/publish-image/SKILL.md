---
name: publish-image
description: Steps for publishing this project's Docker image from GitHub Actions to ghcr.io or another registry, covering the release workflow, image tags, arm64 builds, build provenance and running the published image with Compose. Use this when asked to publish or release the image, to push it to ghcr.io, Docker Hub or another registry, or to deploy a published image instead of building on the server.
---

# Publish the image

A GitHub Actions workflow builds the image and pushes it to a registry, by default `ghcr.io`. Servers then pull a release instead of building from source. The template does not include this workflow. For the image itself, see [docker-image](../docker-image/SKILL.md).

## Decide with the user

Ask first. Use the default if the user has no preference.

- **Registry.** Default: `ghcr.io`. It needs no account or secret: the workflow logs in with `GITHUB_TOKEN`. For others, see [Another registry](#another-registry).
- **Public or private.** Servers must log in to pull a private image. A private repository's image starts private. Making it public cannot be undone.
- **What publishes.** Default: version tags such as `v1.2.3`, and manual runs. Pushes to `main` do not publish: each published commit stays in the registry until deleted, and a deployment should name a version. See [Options](#options).
- **Platforms.** Default: `linux/amd64`. Add `linux/arm64` only if a server needs it. It needs a second build on a second runner, see [Options](#options).

## Steps

1. **Let the publish workflow call CI.** In `.github/workflows/ci.yml`, add `workflow_call:` under `on:`, next to `push` and `pull_request`.

    Why: the `verify` stage of the `Dockerfile` runs the typecheck and tests, but only CI lints and starts the container. The publish workflow runs CI first and publishes nothing if CI fails.

2. **Create the workflow** in `.github/workflows/publish.yml`:

    ```yaml
    name: Publish

    on:
      push:
        tags: ["v*.*.*"]
      workflow_dispatch:

    permissions:
      contents: read

    jobs:
      # the CI jobs, on the commit about to be published
      ci:
        uses: ./.github/workflows/ci.yml

      publish:
        needs: ci
        runs-on: ubuntu-latest
        permissions:
          contents: read
          packages: write
        steps:
          - uses: actions/checkout@v7
          # registries refuse capital letters, and the owner or repository name may have some
          - name: Set the image name
            run: echo "IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_ENV"
          - uses: docker/login-action@v4
            with:
              registry: ghcr.io
              username: ${{ github.actor }}
              password: ${{ secrets.GITHUB_TOKEN }}
          # v1.2.3 becomes 1.2.3, 1.2 and latest; a pre-release such as v1.3.0-rc.1 only 1.3.0-rc.1
          - uses: docker/metadata-action@v6
            id: meta
            with:
              images: ${{ env.IMAGE }}
              tags: |
                type=semver,pattern={{version}}
                type=semver,pattern={{major}}.{{minor}}
                type=sha
          - uses: docker/setup-buildx-action@v4
          - uses: docker/build-push-action@v7
            id: build
            with:
              # the checked-out files; without this line the action clones the repository and skips .dockerignore
              context: .
              push: true
              tags: ${{ steps.meta.outputs.tags }}
              labels: ${{ steps.meta.outputs.labels }}
              cache-from: type=gha
              cache-to: type=gha,mode=max
    ```

    - **`packages: write`** allows the push to `ghcr.io`. Only `publish` has it. The `ci` job keeps the read-only token.
    - **`type=sha`** tags every run `sha-<commit>`. A manual run from a branch gets only that tag.
    - **Bun version.** The workflow installs no Bun and passes no build argument. The image uses `BUN_VERSION` from the `Dockerfile`. The `ci` job uses `packageManager` from `package.json`. Keep them in sync.
    - **`mode=max`** also caches the `deps` and `verify` stages. Unchanged files skip the tests.
    - **Cache scope.** GitHub keeps one cache per branch or tag. A tag run reads its own and the default branch's, never another tag's. So a release builds from scratch unless a recent `main` run filled the cache.
    - **Action versions** were the current majors when written. Check for newer ones with `gh api repos/<owner>/<action>/releases/latest --jq .tag_name`. Keep `actions/checkout` on the version `ci.yml` uses.

3. **Name the image in `compose.yml`.** Above `build: .`, add `image: ghcr.io/<owner>/<repository>:${IMAGE_TAG:-latest}` in lowercase. Keep `build: .`. Add `IMAGE_TAG="latest"` to `.env.example`, with a comment that only Docker Compose reads it.

    - CI and the commands in `AGENTS.md` pass `--build`, so they still build from source.
    - **Do not run `docker compose push`.** It publishes a local build under that name.

4. **Update `README.md`.** Name the image in the Docker section. Document a release as `git tag v1.2.3 && git push origin v1.2.3`. Add the workflow to the continuous integration section.

5. **Check the files, then run the workflow once.**

    - `docker compose config --quiet` must print nothing.
    - Run `actionlint` if installed. It checks syntax, expressions and known action inputs, but runs nothing.
    - **Ask the user first.** A manual run and a tag push both publish an image.
    - With the file on the default branch, `gh workflow run publish.yml --ref main` publishes `sha-<commit>` and no version.
    - Check the visibility of the new package, see [Using the published image](#using-the-published-image).

## Options

**Publish `main` too.** Add `branches: [main]` under `push:` and `type=edge` to `tags:`. Each push to `main` then publishes `edge` and `sha-<commit>`, and fills the cache that releases read. CI runs twice per such push, once per workflow.

**Add `linux/arm64`.** Build each platform on a native runner, then join both images under one name. The `ubuntu-24.04-arm` runner is free in public repositories. In private ones it uses Actions minutes. Replace the `publish` job with these two:

```yaml
  build:
    needs: ci
    strategy:
      matrix:
        include:
          - { arch: amd64, runner: ubuntu-latest }
          - { arch: arm64, runner: ubuntu-24.04-arm }
    runs-on: ${{ matrix.runner }}
    permissions: { contents: read, packages: write }
    outputs:
      tags: ${{ steps.meta.outputs.tags }}
      amd64: ${{ steps.digest.outputs.amd64 }}
      arm64: ${{ steps.digest.outputs.arm64 }}
    steps:
      # the steps of the `publish` job from `actions/checkout` to `docker/setup-buildx-action`, unchanged
      - uses: docker/build-push-action@v7
        id: build
        with:
          context: .
          labels: ${{ steps.meta.outputs.labels }}
          # pushed without a tag; the merge job adds the tags
          tags: ${{ env.IMAGE }}
          outputs: type=image,push-by-digest=true,name-canonical=true,push=true
          # one cache per platform, or each build replaces the other's
          cache-from: type=gha,scope=${{ matrix.arch }}
          cache-to: type=gha,mode=max,scope=${{ matrix.arch }}
      - id: digest
        run: echo "${{ matrix.arch }}=$IMAGE@${{ steps.build.outputs.digest }}" >> "$GITHUB_OUTPUT"

  merge:
    needs: build
    runs-on: ubuntu-latest
    permissions: { packages: write }
    steps:
      # the `docker/login-action` and `docker/setup-buildx-action` steps of the `build` job
      - name: Publish both images under every tag
        env:
          TAGS: ${{ needs.build.outputs.tags }}
        run: |
          mapfile -t tags <<< "$TAGS"
          docker buildx imagetools create "${tags[@]/#/--tag=}" \
            "${{ needs.build.outputs.amd64 }}" "${{ needs.build.outputs.arm64 }}"
```

**Do not build both platforms in one job** with `docker/setup-qemu-action`. Under emulation, arm64 runs the whole `verify` stage: install, typecheck and every test, including the tests that start processes and wait for signals. Running `verify` only on the build platform avoids that, but ships an arm64 image never tested on arm64.

**Record build provenance.** `docker/build-push-action` already attaches an unsigned provenance record. An attestation is the signed kind. Verify it with `gh attestation verify oci://<image>:<tag> --repo <owner>/<repository>`. Offer it for public repositories. For private ones, GitHub has it only on the Enterprise Cloud plan.

Give the `publish` job `id-token: write` (signing certificate) and `attestations: write` (storage). Add this step at its end:

```yaml
      - uses: actions/attest@v4
        with:
          subject-name: ${{ env.IMAGE }}
          subject-digest: ${{ steps.build.outputs.digest }}
          push-to-registry: true
```

- **Organization-owned repository:** also add `artifact-metadata: write`. Without it the step only warns.
- **With arm64**, the step goes in the `merge` job and needs the digest of the joined image, from `docker buildx imagetools create --metadata-file`. This is not worked out here.

## Using the published image

A server needs only `compose.yml`, `.env` and the data directory. Set `IMAGE_TAG=1.2.3` in `.env`, then run `docker compose up --wait --no-build --pull always`.

- **Versions.** `1.2.3` is one release. `1.2` and `latest` move with each release, so a deployment that names them changes on its next pull.
- **`image:` plus `build:`.** What Compose does:
    - `--build`: builds from the directory and names the result after `image:`.
    - `--no-build --pull always`: pulls.
    - Neither: uses the local image. Pulls if there is none. Builds only if that pull fails.
- **Private image.** Log in once on the server with a personal access token (classic) that has `read:packages`: `echo "$TOKEN" | docker login ghcr.io -u <user> --password-stdin`.
- **Visibility.** A private repository publishes a private image. A public one can publish either, so check the package after the first run. To change it, open the package page on GitHub: Package settings > Danger Zone > Change visibility. A public package cannot become private again.

## Another registry

Only these change. Visibility and server login follow that registry's rules.

- **Image name.** Write it out in lowercase in the `Set the image name` step: `IMAGE=docker.io/<user>/<name>` for Docker Hub, `IMAGE=registry.example.com/<path>/<name>` for a private registry. Use the same name in `compose.yml`.
- **Login.** For Docker Hub, remove `registry:` and pass `username: ${{ vars.DOCKERHUB_USERNAME }}` and `password: ${{ secrets.DOCKERHUB_TOKEN }}` (an access token that can write). For another registry, set `registry:` to its host name. The user adds both in the repository settings.
- **User name.** Keep it a variable, not a secret. GitHub drops a job output that contains a secret, and the image name contains the user name. That breaks the arm64 option.
- **Permissions.** Remove `packages: write`. Only `ghcr.io` uses it.

## Troubleshooting

| Problem | Cause and fix |
| --- | --- |
| Push refused (`denied`) | The job lacks `packages: write`. Or a package of that name exists that this repository did not create: on the package page, open Package settings > Manage Actions access and add the repository with the Write role |
| `repository name must be lowercase` | A hand-written image name, in `compose.yml` or an `IMAGE=` line, has a capital letter. The workflow lowercases only `GITHUB_REPOSITORY` |
| A server cannot pull the image | The package is private and Docker on the server is not logged in to `ghcr.io`, or the token lacks `read:packages`. While the service has `build:`, Compose only warns and uses the local image |
| A release rebuilds every layer | It cannot read another tag's cache, see step 2. Run the workflow manually on `main` before the release, or publish `main` too |
| The arm64 build is many times slower | Both platforms build in one job, so arm64 is emulated. Give each platform its own runner, see [Options](#options) |
| The package lists platform `unknown/unknown` | That is the provenance record of `docker/build-push-action`, not a second image |
