---
name: publish-image
description: Steps for publishing this project's Docker image to a container registry from GitHub Actions, covering the release workflow for GitHub Container Registry, image tags, arm64 builds, build provenance and running the published image with Compose. Use this when asked to publish or release the image, to push it to ghcr.io, Docker Hub or another registry, or to deploy a published image instead of building on the server.
---

# Publish the image

A GitHub Actions workflow builds the image and pushes it to a container registry, by default GitHub Container Registry (`ghcr.io`). A server then pulls a released version instead of building from source. The template does not ship with it. [docker-image](../docker-image/SKILL.md) describes the image itself.

## Decide with the user

Ask these before you start, and use the default where the user has no preference.

- **Registry.** `ghcr.io` is the default. It needs no account and no secret, because the workflow logs in with its own `GITHUB_TOKEN`. For Docker Hub or a private registry, see [Another registry](#another-registry).
- **Public or private image.** Every server has to log in before it can pull a private image. An image from a private repository starts private, and making it public cannot be undone.
- **What publishes.** By default a version tag such as `v1.2.3`, and a run started by hand. A push to `main` does not: every published commit stays in the registry until someone deletes it, and a deployment should name a version. [Options](#options) adds `main`.
- **Platforms.** `linux/amd64` by default. Add `linux/arm64` only when a server needs it, because it takes a second build on a second runner, see [Options](#options).

## Steps

1. **Let the publish workflow call the CI workflow.** In `.github/workflows/ci.yml`, add `workflow_call:` as a third trigger under `on:`, next to `push` and `pull_request`.

    The image build already stops at a type error or a failing test, because the `verify` stage of the `Dockerfile` runs both. It does not run the lint, and it never starts the container. The CI workflow does both, so the publish workflow runs it first and publishes nothing when one of its jobs fails.

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
      # the jobs of the CI workflow, for the commit that is about to be published
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
          # a registry refuses capital letters in an image name, and the owner or the repository may have some
          - name: Set the image name
            run: echo "IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_ENV"
          - uses: docker/login-action@v4
            with:
              registry: ghcr.io
              username: ${{ github.actor }}
              password: ${{ secrets.GITHUB_TOKEN }}
          # the tag v1.2.3 becomes 1.2.3, 1.2 and latest, a pre-release such as v1.3.0-rc.1 only 1.3.0-rc.1
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

    - `packages: write` lets the job push to `ghcr.io`. Only the `publish` job has it. The `ci` job keeps the read-only token.
    - `type=sha` adds the tag `sha-<commit>` to every run. A run started by hand from a branch publishes only that tag.
    - The workflow does not install Bun and passes no build argument. The image is built with `BUN_VERSION` from the `Dockerfile`, and the `ci` job reads `packageManager` from `package.json`. Keep the two in sync, as before.
    - `mode=max` also caches the `deps` and `verify` stages, so a build with unchanged files does not run the tests again. GitHub keeps one cache per branch or tag: a run for a tag reads the cache of the default branch and its own, never that of another tag. So a release builds from scratch unless a recent run on `main` filled the cache.
    - The action versions were the current major versions when this was written. Look for a newer one with `gh api repos/<owner>/<action>/releases/latest --jq .tag_name`, and keep `actions/checkout` on the version that `ci.yml` uses.

3. **Name the image in `compose.yml`.** Add `image: ghcr.io/<owner>/<repository>:${IMAGE_TAG:-latest}` on the line above `build: .`, in lowercase, and keep `build: .`. Add `IMAGE_TAG="latest"` to `.env.example`, with a comment that only Docker Compose reads it.

    The CI workflow and the commands in `AGENTS.md` pass `--build`, so they keep building from source. Do not run `docker compose push`: it would publish a local build under that name.

4. **Update the documentation.** In `README.md`, name the image in the Docker section, say that a release is `git tag v1.2.3 && git push origin v1.2.3`, and add the workflow to the section on continuous integration.

5. **Check the files, then run the workflow once.** `docker compose config --quiet` must print nothing. Run `actionlint` if it is installed: it checks the syntax, the expressions and the inputs of the actions it knows, but runs nothing.

    Starting a run and pushing a tag both publish an image, so ask the user first. Once the file is on the default branch, `gh workflow run publish.yml --ref main` starts a run that publishes `sha-<commit>` and no version. Then check the visibility of the new package, see [Using the published image](#using-the-published-image).

## Options

**Publish `main` too.** Add `branches: [main]` under `push:` and the line `type=edge` to `tags:`. Every push to `main` then publishes `edge` and `sha-<commit>`, and fills the cache that the release builds read. The CI jobs run twice for such a push, once in each workflow.

**Add `linux/arm64`.** Build each platform on a runner of that architecture, then join the two images under one name. The `ubuntu-24.04-arm` runner is free in a public repository and uses the Actions minutes of the account in a private one. Replace the `publish` job with these two:

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
          # pushed without a tag, the merge job gives the pair its tags
          tags: ${{ env.IMAGE }}
          outputs: type=image,push-by-digest=true,name-canonical=true,push=true
          # one cache per platform, or each build replaces the cache of the other
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

Do not build both platforms in one job with `docker/setup-qemu-action` instead. That emulates arm64, so the `verify` stage would install, typecheck and run every test under emulation, including the tests that start server processes and wait for signals. Running `verify` on the build platform only avoids that, but publishes an arm64 image whose tests never ran on arm64.

**Record build provenance.** `docker/build-push-action` already attaches an unsigned provenance record to the image. An attestation is the signed kind, checked with `gh attestation verify oci://<image>:<tag> --repo <owner>/<repository>`. Offer it when the repository is public: for a private one GitHub has it only on the Enterprise Cloud plan.

Add `id-token: write`, for the signing certificate, and `attestations: write`, to store the result, to the permissions of the `publish` job. Then add this step at its end:

```yaml
      - uses: actions/attest@v4
        with:
          subject-name: ${{ env.IMAGE }}
          subject-digest: ${{ steps.build.outputs.digest }}
          push-to-registry: true
```

A repository that an organization owns also wants `artifact-metadata: write`. Without it the step only warns. With the arm64 option the step belongs in the `merge` job and needs the digest of the joined image, which `docker buildx imagetools create --metadata-file` reports. That combination is not worked out here.

## Using the published image

A server needs `compose.yml`, its `.env` file and the data directory, not the source. Set `IMAGE_TAG=1.2.3` in `.env` and start it with `docker compose up --wait --no-build --pull always`.

- **Versions.** `1.2.3` names one release. `1.2` and `latest` move with every release, so a deployment that names them changes the next time it pulls.
- **`image:` together with `build:`.** With `--build`, Compose builds from the directory and gives the result the name in `image:`. With `--no-build --pull always` it pulls. With neither it uses the image the machine already has, pulls when it has none, and builds only when that pull fails.
- **Private image.** Log in once on the server, with a personal access token (classic) that has the `read:packages` scope: `echo "$TOKEN" | docker login ghcr.io -u <user> --password-stdin`.
- **Visibility.** An image published from a private repository is private. From a public repository it can start as either, so look at the package after the first run. To change it, open the package page on GitHub, then Package settings, Danger Zone, Change visibility. A public package cannot be made private again.

## Another registry

These things change, and the rest of the workflow stays. Visibility and the login on the server follow the rules of that registry.

- **Image name.** Write it out in the `Set the image name` step, in lowercase: `IMAGE=docker.io/<user>/<name>` for Docker Hub, `IMAGE=registry.example.com/<path>/<name>` for a private registry. Use the same name in `compose.yml`.
- **Login.** For Docker Hub, remove `registry:` and pass `username: ${{ vars.DOCKERHUB_USERNAME }}` and `password: ${{ secrets.DOCKERHUB_TOKEN }}`, an access token that may write. For another registry, set `registry:` to its host name. The user adds the variable and the secret in the settings of the repository.
- **User name.** Keep it a variable, not a secret. It is part of the image name, and GitHub drops a job output that contains a secret, which breaks the arm64 option.
- **Permissions.** Remove `packages: write`. Only `ghcr.io` uses it.

## Troubleshooting

| Problem | Cause and fix |
| --- | --- |
| The registry refuses the push (`denied`) | The job has no `packages: write`. Or a package of that name already exists and this repository did not create it: on the package page, under Package settings, Manage Actions access, add the repository with the Write role |
| `repository name must be lowercase` | An image name written by hand has a capital letter, in `compose.yml` or in an `IMAGE=` line. The workflow only lowercases `GITHUB_REPOSITORY` |
| A server cannot pull the image | The package is private and Docker on the server is not logged in to `ghcr.io`, or its token lacks `read:packages`. While the service has `build:`, Compose only warns about the failed pull and goes on with the image the machine already has |
| A release builds every layer again | The cache of another tag is out of reach, see step 2. Start the workflow by hand on `main` before the release, or publish `main` too |
| The arm64 build takes many times longer | Both platforms are built in one job, so arm64 is emulated. Give each platform its own runner, see [Options](#options) |
| The package lists a platform `unknown/unknown` | That entry is the provenance record of `docker/build-push-action`, not a second image |
