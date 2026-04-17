import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { verifySignature } from "./verify.ts";

// These tests exercise the verification primitive directly. Full
// fetch-handler integration is covered by running the server against
// a TestWorkflowEnvironment — which is expensive and is left for a
// future e2e suite.

describe("verifySignature", () => {
	const secret = "s3cret";

	function sign(body: string) {
		return createHmac("sha256", secret).update(body).digest("hex");
	}

	test("accepts a valid signature", () => {
		const body = `{"ref":"refs/heads/main"}`;
		expect(verifySignature(body, sign(body), secret)).toBe(true);
	});

	test("rejects a tampered body", () => {
		const body = `{"ref":"refs/heads/main"}`;
		expect(verifySignature(`${body} `, sign(body), secret)).toBe(false);
	});

	test("rejects an empty signature", () => {
		expect(verifySignature("body", "", secret)).toBe(false);
	});

	test("rejects a wrong-length signature without timing-safe throw", () => {
		// Half-length hex — would throw in timingSafeEqual without the length guard
		expect(verifySignature("body", "deadbeef", secret)).toBe(false);
	});

	test("rejects a 64-char signature that is not valid hex", () => {
		// Right length for SHA-256, but contains non-hex characters.
		// Buffer.from(..., "hex") silently truncates invalid input, so a
		// stricter hex check is safer.
		const notHex = "z".repeat(64);
		expect(verifySignature("body", notHex, secret)).toBe(false);
	});

	test("accepts uppercase hex", () => {
		const body = `{"ref":"refs/heads/main"}`;
		expect(verifySignature(body, sign(body).toUpperCase(), secret)).toBe(true);
	});
});
