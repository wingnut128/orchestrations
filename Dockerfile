# ──────────────────────────────────────────────────────────────
# Build stage — Chainguard node:latest-dev has shell + package manager
# Install bun here for dep resolution and TS transpilation
# ──────────────────────────────────────────────────────────────
FROM cgr.dev/chainguard/node:latest-dev AS build

WORKDIR /app

# Install bun (npm is available in the -dev variant)
RUN npm install -g bun

# Copy dependency manifests first for layer caching
COPY package.json bun.lock ./

# Install all dependencies (including devDependencies for build)
# --frozen-lockfile ensures reproducible builds
RUN bun install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY src/ src/

# Build each worker entry point for Node.js
# --target node emits CJS that Node can run directly
# --packages external keeps node_modules imports as require() calls
RUN mkdir -p dist/workers dist/workflows dist/activities \
    && bun build src/workers/greeter.ts \
        --target node --outdir dist/workers --packages external \
    && bun build src/workers/ci-pipeline.ts \
        --target node --outdir dist/workers --packages external \
    && bun build src/workers/agent-task.ts \
        --target node --outdir dist/workers --packages external

# Build workflow files — the Temporal SDK loads these via workflowsPath
# at runtime and bundles them into a V8 isolate. They need to be
# resolvable JS files on disk.
RUN bun build src/workflows/greeter.ts \
        --target node --outdir dist/workflows --packages external \
    && bun build src/workflows/agent-task.ts \
        --target node --outdir dist/workflows --packages external \
    && bun build src/workflows/ci-pipeline.ts \
        --target node --outdir dist/workflows --packages external

# Build activity files — imported by workers at runtime
RUN bun build src/activities/greeter.ts \
        --target node --outdir dist/activities --packages external \
    && bun build src/activities/ci-pipeline.ts \
        --target node --outdir dist/activities --packages external \
    && bun build src/activities/claude-agent.ts \
        --target node --outdir dist/activities --packages external

# Prune devDependencies from node_modules for a smaller runtime image
RUN bun install --frozen-lockfile --production

# ──────────────────────────────────────────────────────────────
# Runtime stage — Chainguard node:latest is minimal (no shell)
# Runs as non-root by default
# ──────────────────────────────────────────────────────────────
FROM cgr.dev/chainguard/node:latest

WORKDIR /app

# Copy production node_modules (includes native addons like @temporalio/core-bridge)
COPY --from=build /app/node_modules ./node_modules

# Copy compiled JS output
COPY --from=build /app/dist ./dist

# Default: run the greeter worker. Override via WORKER_NAME env var
# or docker-compose command.
ENV WORKER_NAME=greeter

# The entrypoint runs the selected worker with Node.
# Because the runtime image has no shell, use the exec form and
# point directly at the node binary. The CMD provides the default
# worker; override it in docker-compose or at run time.
ENTRYPOINT ["node"]
CMD ["dist/workers/greeter.js"]
