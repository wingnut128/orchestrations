/**
 * Shared configuration — reads from environment variables.
 *
 * Required env vars:
 *   TEMPORAL_ADDRESS  — Temporal server (default: localhost:7233)
 *   FORGEJO_URL       — Forgejo base URL (default: http://localhost:3000)
 *   FORGEJO_TOKEN     — Forgejo API token (generate at /user/settings/applications)
 *   WEBHOOK_PORT      — Port for the webhook receiver (default: 4000)
 *   WEBHOOK_SECRET    — Shared secret for Forgejo webhook HMAC validation
 */

export const config = {
	temporal: {
		address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
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
} as const;
