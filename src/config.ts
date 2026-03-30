/**
 * Shared configuration — reads from environment variables.
 *
 * Required env vars:
 *   TEMPORAL_ADDRESS  — Temporal server (default: localhost:7233)
 *   FORGEJO_URL       — Forgejo base URL (default: http://localhost:3000)
 *   FORGEJO_TOKEN     — Forgejo API token (generate at /user/settings/applications)
 *   WEBHOOK_PORT      — Port for the webhook receiver (default: 4000)
 *   WEBHOOK_SECRET    — Shared secret for Forgejo webhook HMAC validation
 *
 * OpenTelemetry (optional):
 *   OTEL_ENABLED                    — Set to "true" to enable tracing
 *   OTEL_EXPORTER_OTLP_ENDPOINT    — OTLP HTTP endpoint (default: http://localhost:4318)
 *   OTEL_EXPORTER_OTLP_HEADERS     — Headers for OTLP exporter (e.g. auth tokens)
 *   OTEL_SERVICE_NAME              — Service name for traces (default: orchestrations)
 *
 * Local dev (Jaeger):
 *   OTEL_ENABLED=true
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
 *
 * Honeycomb:
 *   OTEL_ENABLED=true
 *   OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
 *   OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=<your-api-key>
 */

export const config = {
	temporal: {
		address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
		namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
		apiKey: process.env.TEMPORAL_API_KEY ?? "",
		tls: {
			certPath: process.env.TEMPORAL_TLS_CERT_PATH ?? "",
			keyPath: process.env.TEMPORAL_TLS_KEY_PATH ?? "",
		},
	},
	forgejo: {
		url: (process.env.FORGEJO_URL ?? "http://localhost:3000").replace(
			/\/$/,
			"",
		),
		token: process.env.FORGEJO_TOKEN ?? "",
	},
	webhook: {
		port: Number.parseInt(process.env.WEBHOOK_PORT ?? "4000", 10),
		secret: process.env.WEBHOOK_SECRET ?? "",
	},
	otel: {
		enabled: process.env.OTEL_ENABLED === "true",
		endpoint:
			process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318",
		serviceName: process.env.OTEL_SERVICE_NAME ?? "orchestrations",
	},
} as const;
