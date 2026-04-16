import { describe, expect, test } from "bun:test";
import { parsePort } from "./config.ts";

describe("parsePort", () => {
	test("returns fallback for undefined", () => {
		expect(parsePort(undefined, 4000, "WEBHOOK_PORT")).toBe(4000);
	});

	test("returns fallback for empty string", () => {
		expect(parsePort("", 4000, "WEBHOOK_PORT")).toBe(4000);
	});

	test("parses a valid port", () => {
		expect(parsePort("8080", 4000, "WEBHOOK_PORT")).toBe(8080);
	});

	test("throws on non-numeric input", () => {
		expect(() => parsePort("abc", 4000, "WEBHOOK_PORT")).toThrow(
			"WEBHOOK_PORT must be an integer",
		);
	});

	test("throws on zero", () => {
		expect(() => parsePort("0", 4000, "WEBHOOK_PORT")).toThrow();
	});

	test("throws on out-of-range port", () => {
		expect(() => parsePort("70000", 4000, "WEBHOOK_PORT")).toThrow();
	});

	test("throws on negative port", () => {
		expect(() => parsePort("-1", 4000, "WEBHOOK_PORT")).toThrow();
	});
});
