# The APPWITHAI generator, as an image.
#
# What comes out is the design-and-generate application: sign in, bring a model,
# generate a full-stack app from it, and — at the deploy step — build that
# generated app into an image of its own.
#
# That last part is why the runtime stage carries a docker client. The container
# does not run a daemon; it talks to the host's, which means the socket has to be
# handed in:
#
#   docker run -v /var/run/docker.sock:/var/run/docker.sock …
#
# Without it everything works except deploy, which will say so rather than fail
# obscurely.
#
# Two ways to give it a model, both handled by the entrypoint:
#
#   SEED_MODEL=/models/drug-discovery.eml.mmd   a mounted .mmd document
#   SEED_DATABASE_URL=postgres://…              an existing schema to read
#
# And one database of its own, which may be local or hosted:
#
#   DATABASE_URL=postgresql://…                 Neon and friends work as-is; TLS
#                                               is negotiated for remote hosts

# Behind a TLS-intercepting proxy — corporate egress, or a sandboxed CI runner —
# the build cannot verify any certificate until it trusts that proxy's CA. Drop
# the certificate into `docker/ca-certificates/` and it is installed in both
# stages; the directory is empty by default and the whole step is a no-op:
#
#   cp corporate-ca.crt docker/ca-certificates/
#   docker build --network host \
#     --build-arg HTTPS_PROXY="$HTTPS_PROXY" --build-arg NO_PROXY="$NO_PROXY" .
#
# ─── certificates ───────────────────────────────────────────────────────────
# One stage, reused by both of the real ones, so the trust store is assembled
# identically in each and the install layer is cached once.
FROM oven/bun:1.4.4 AS certs

# The directory always exists, so this COPY always succeeds; whether it carries
# anything is up to whoever is building.
COPY docker/ca-certificates/ /usr/local/share/ca-certificates/

# Always produce /ca-bundle.crt, even with nothing to add and even if the base
# image ships no bundle of its own — the later stages copy this path
# unconditionally, and a COPY of a file that does not exist fails the build.
RUN touch /ca-bundle.crt \
 && cat /etc/ssl/certs/ca-certificates.crt >> /ca-bundle.crt 2>/dev/null || true; \
    if ls /usr/local/share/ca-certificates/*.crt >/dev/null 2>&1; then \
      cat /usr/local/share/ca-certificates/*.crt >> /ca-bundle.crt; \
      echo "added $(ls /usr/local/share/ca-certificates/*.crt | wc -l) extra CA certificate(s)"; \
    else \
      echo "no extra CA certificates supplied"; \
    fi

# ─── build ──────────────────────────────────────────────────────────────────
FROM oven/bun:1.4.4 AS build

ARG HTTP_PROXY=""
ARG HTTPS_PROXY=""
ARG NO_PROXY=""
ENV HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    NO_PROXY=${NO_PROXY} \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

COPY --from=certs /ca-bundle.crt /etc/ssl/certs/ca-certificates.crt

WORKDIR /app

# Manifests first: this layer only changes when a dependency does, so editing
# source does not re-run the install.
COPY package.json bun.lock ./
COPY packages/core/package.json ./packages/core/
COPY packages/generator/package.json ./packages/generator/
COPY packages/ai/package.json ./packages/ai/
COPY packages/web/package.json ./packages/web/
RUN bun install --frozen-lockfile

COPY . .

# Same order as `bun run build`, minus the lint step — a lint warning should not
# stop an image from being produced.
RUN bun run build:core \
 && bun run build:generator \
 && bun run build:ai \
 && bun run build:web

# Drop the dev tree once it has produced the bundles. Vite, Vitest, Playwright
# and the type checker are half the image and none of them run in production —
# the server serves a bundle that was already built.
RUN bun install --frozen-lockfile --production \
 && rm -rf /root/.bun/install/cache node_modules/.cache packages/*/node_modules/.cache

# ─── runtime ────────────────────────────────────────────────────────────────
FROM oven/bun:1.4.4

ARG HTTP_PROXY=""
ARG HTTPS_PROXY=""
ARG NO_PROXY=""

# A first copy, so the package installs below can themselves reach the network
# through a TLS-intercepting proxy. It is written again after those installs —
# see the second copy for why.
COPY --from=certs /ca-bundle.crt /etc/ssl/certs/ca-certificates.crt

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt \
    DEFAULT_OUTPUT_DIR=/app/generated-projects

# Debian, not Alpine, and not by preference: the embedding model behind the
# model-context assistant pulls in onnxruntime-node, whose prebuilt
# `libonnxruntime.so` is linked against glibc. On musl it fails to load with
# "Error loading shared library ld-linux-x86-64.so.2", which surfaces as a 500
# from the assistant and nothing else — the rest of the app looks fine.
#
# postgresql-client  wait for the database before migrating
# git                the generator initialises a repository in each project
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client git ca-certificates curl wget \
 && rm -rf /var/lib/apt/lists/*

# Just the docker client, so the deploy step can build an image on the host's
# daemon. The distro package would drag in a daemon this container never runs.
ARG DOCKER_CLI_VERSION=27.5.1
RUN curl -fsSL "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_CLI_VERSION}.tgz" \
      -o /tmp/docker.tgz \
 && tar -xzf /tmp/docker.tgz -C /usr/local/bin --strip-components=1 docker/docker \
 && rm /tmp/docker.tgz \
 && docker --version

# Again, and this is the copy that matters: installing `ca-certificates` runs
# update-ca-certificates, which rebuilds this exact file from /usr/share and
# throws away anything appended to it. The container ended up with the stock
# 150-certificate bundle and no proxy CA, and the only symptom was that the
# deploy step's builds could not verify the package registry.
COPY --from=certs /ca-bundle.crt /etc/ssl/certs/ca-certificates.crt

# The whole workspace, not just the build output. The generator shells out to its
# own CLI, reads Handlebars templates off disk and runs `bun install` inside each
# project it writes, so the sources and templates have to be present — a runtime
# image pruned to dist alone can start but cannot generate anything.
COPY --from=build /app /app

# Somewhere to write generated applications. Mount a volume over it to keep them.
RUN mkdir -p /app/generated-projects /models

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000

# Reports unhealthy while the database is unreachable, which is the failure
# worth surfacing: the app answers on the port long before it is usable.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT}/api/health" || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["bun", "run", "--cwd", "packages/web", "start"]
