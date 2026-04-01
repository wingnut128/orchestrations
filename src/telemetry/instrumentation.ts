import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";

const tracer = trace.getTracer("orchestrations");

/**
 * Wrap a Claude API call in an OTel span. Records model, token usage,
 * and conversation length as span attributes.
 */
export async function traceClaudeCall<T>(
	spanName: string,
	attrs: {
		model?: string;
		messageCount?: number;
	},
	fn: (span: Span) => Promise<T>,
): Promise<T> {
	return tracer.startActiveSpan(spanName, async (span) => {
		try {
			if (attrs.model) span.setAttribute("ai.model", attrs.model);
			if (attrs.messageCount != null)
				span.setAttribute("ai.messages.count", attrs.messageCount);

			const result = await fn(span);
			span.setStatus({ code: SpanStatusCode.OK });
			return result;
		} catch (err) {
			span.setStatus({
				code: SpanStatusCode.ERROR,
				message: err instanceof Error ? err.message : String(err),
			});
			throw err;
		} finally {
			span.end();
		}
	});
}

/**
 * Wrap an activity function in an OTel span.
 */
export async function traceActivity<T>(
	spanName: string,
	fn: (span: Span) => Promise<T>,
): Promise<T> {
	return tracer.startActiveSpan(spanName, async (span) => {
		try {
			const result = await fn(span);
			span.setStatus({ code: SpanStatusCode.OK });
			return result;
		} catch (err) {
			span.setStatus({
				code: SpanStatusCode.ERROR,
				message: err instanceof Error ? err.message : String(err),
			});
			throw err;
		} finally {
			span.end();
		}
	});
}
