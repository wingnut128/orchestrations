import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import {
	BatchSpanProcessor,
	NodeTracerProvider,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { config } from "../config.ts";

let provider: NodeTracerProvider | null = null;

/**
 * Initialize OpenTelemetry tracing. Call once at process startup
 * (before Worker.create or server.listen). No-op if OTEL_ENABLED !== "true".
 */
export function initTracing(): void {
	if (!config.otel.enabled) return;
	if (provider) return; // already initialized

	const resource = new Resource({
		[ATTR_SERVICE_NAME]: config.otel.serviceName,
	});

	const exporter = new OTLPTraceExporter({
		url: `${config.otel.endpoint}/v1/traces`,
	});

	provider = new NodeTracerProvider({
		resource,
		spanProcessors: [
			process.env.NODE_ENV === "test"
				? new SimpleSpanProcessor(exporter)
				: new BatchSpanProcessor(exporter),
		],
	});

	provider.register();

	console.log(
		`[telemetry] Tracing enabled → ${config.otel.endpoint} (service: ${config.otel.serviceName})`,
	);
}

/** Gracefully flush and shut down the tracer provider. */
export async function shutdownTracing(): Promise<void> {
	if (provider) {
		await provider.shutdown();
		provider = null;
	}
}
