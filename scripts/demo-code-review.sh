#!/usr/bin/env bash
set -euo pipefail

# Demo: agent-to-agent code review flow
# Starts Temporal dev server, CI pipeline worker, code review worker,
# then runs the demo client that orchestrates both workflows.

cleanup() {
	echo ""
	echo "Shutting down..."
	kill "${PIDS[@]}" 2>/dev/null || true
	wait "${PIDS[@]}" 2>/dev/null || true
	echo "Done."
}
trap cleanup EXIT

PIDS=()

# Start Temporal dev server (skip if already running)
if ! curl -sf http://localhost:7233 >/dev/null 2>&1; then
	echo "Starting Temporal dev server..."
	temporal server start-dev --log-level error &
	PIDS+=($!)
	sleep 3
else
	echo "Temporal dev server already running."
fi

# Start CI pipeline worker
echo "Starting CI pipeline worker..."
bun run src/workers/ci-pipeline.ts &
PIDS+=($!)
sleep 2

# Start code review worker (needs API key via op)
echo "Starting code review worker..."
op run --env-file="./.env" -- bun run src/workers/code-review.ts &
PIDS+=($!)
sleep 2

# Run the demo client
echo ""
echo "=== Running code review demo ==="
echo ""
op run --env-file="./.env" -- bun run src/clients/run-code-review-demo.ts

echo ""
echo "=== Demo complete ==="
