#!/usr/bin/env bash
set -euo pipefail

# Smoke test: verify connectivity to Temporal Cloud
# Starts a greeter worker, runs the greeter client, then shuts down.
#
# Usage:
#   op run --env-file="./.env" -- ./scripts/test-temporal-cloud.sh
#
# Required env vars (set in .env with op:// URIs):
#   TEMPORAL_ADDRESS    — e.g. your-ns.abc123.tmprl.cloud:7233
#   TEMPORAL_NAMESPACE  — e.g. your-ns.abc123
#   TEMPORAL_API_KEY    — Temporal Cloud API key

# --- Preflight checks ---

if [[ -z "${TEMPORAL_ADDRESS:-}" ]]; then
	echo "ERROR: TEMPORAL_ADDRESS is not set" >&2
	exit 1
fi
if [[ -z "${TEMPORAL_NAMESPACE:-}" ]]; then
	echo "ERROR: TEMPORAL_NAMESPACE is not set" >&2
	exit 1
fi
if [[ -z "${TEMPORAL_API_KEY:-}" ]]; then
	echo "ERROR: TEMPORAL_API_KEY is not set" >&2
	exit 1
fi

echo "Temporal Cloud smoke test"
echo "  Address:   ${TEMPORAL_ADDRESS}"
echo "  Namespace: ${TEMPORAL_NAMESPACE}"
echo ""

# --- Cleanup on exit ---

WORKER_PID=""
cleanup() {
	if [[ -n "${WORKER_PID}" ]]; then
		echo ""
		echo "Shutting down worker..."
		kill "${WORKER_PID}" 2>/dev/null || true
		wait "${WORKER_PID}" 2>/dev/null || true
	fi
	echo "Done."
}
trap cleanup EXIT

# --- Start greeter worker ---

echo "Starting greeter worker..."
bun run src/workers/greeter.ts &
WORKER_PID=$!
sleep 3

# Verify worker is still running (didn't crash on connect)
if ! kill -0 "${WORKER_PID}" 2>/dev/null; then
	echo "ERROR: Worker failed to start — check credentials and address" >&2
	exit 1
fi
echo "Worker connected successfully."
echo ""

# --- Run greeter client ---

echo "=== Running greeter workflow ==="
echo ""
bun run src/clients/run-greeter.ts

echo ""
echo "=== Temporal Cloud smoke test passed ==="
