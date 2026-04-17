import { describe, expect, test } from "bun:test";
import { parseSnykOutput } from "./security-scan.ts";

describe("parseSnykOutput", () => {
	test("clean scan with no vulnerabilities", () => {
		const input = JSON.stringify({
			ok: true,
			vulnerabilities: [],
			summary: "No known vulnerabilities",
		});

		const result = parseSnykOutput(input);

		expect(result.critical).toBe(0);
		expect(result.high).toBe(0);
		expect(result.medium).toBe(0);
		expect(result.low).toBe(0);
		expect(result.summary).toBe("No vulnerabilities found");
	});

	test("mixed severity vulnerabilities", () => {
		const input = JSON.stringify({
			ok: false,
			vulnerabilities: [
				{
					id: "SNYK-1",
					severity: "critical",
					title: "RCE",
					packageName: "foo",
					version: "1.0.0",
				},
				{
					id: "SNYK-2",
					severity: "high",
					title: "SQLi",
					packageName: "bar",
					version: "2.0.0",
				},
				{
					id: "SNYK-3",
					severity: "high",
					title: "XSS",
					packageName: "baz",
					version: "3.0.0",
				},
				{
					id: "SNYK-4",
					severity: "medium",
					title: "Info leak",
					packageName: "qux",
					version: "4.0.0",
				},
				{
					id: "SNYK-5",
					severity: "low",
					title: "DoS",
					packageName: "quux",
					version: "5.0.0",
				},
				{
					id: "SNYK-6",
					severity: "low",
					title: "DoS2",
					packageName: "corge",
					version: "6.0.0",
				},
			],
		});

		const result = parseSnykOutput(input);

		expect(result.critical).toBe(1);
		expect(result.high).toBe(2);
		expect(result.medium).toBe(1);
		expect(result.low).toBe(2);
		expect(result.summary).toBe(
			"Found 6 vulnerabilities: 1 critical, 2 high, 1 medium, 2 low",
		);
	});

	test("only low/medium findings (pipeline should approve)", () => {
		const input = JSON.stringify({
			ok: false,
			vulnerabilities: [
				{
					id: "SNYK-1",
					severity: "medium",
					title: "Weak hash",
					packageName: "a",
					version: "1.0.0",
				},
				{
					id: "SNYK-2",
					severity: "low",
					title: "Info",
					packageName: "b",
					version: "1.0.0",
				},
			],
		});

		const result = parseSnykOutput(input);

		expect(result.critical).toBe(0);
		expect(result.high).toBe(0);
		expect(result.medium).toBe(1);
		expect(result.low).toBe(1);
	});

	test("throws on malformed JSON", () => {
		expect(() => parseSnykOutput("not json")).toThrow();
	});

	test("ignores unknown severity levels", () => {
		const input = JSON.stringify({
			ok: false,
			vulnerabilities: [
				{
					id: "SNYK-1",
					severity: "critical",
					title: "RCE",
					packageName: "a",
					version: "1.0.0",
				},
				{
					id: "SNYK-2",
					severity: "unknown",
					title: "???",
					packageName: "b",
					version: "1.0.0",
				},
			],
		});

		const result = parseSnykOutput(input);

		expect(result.critical).toBe(1);
		expect(result.high).toBe(0);
		expect(result.medium).toBe(0);
		expect(result.low).toBe(0);
		expect(result.summary).toBe(
			"Found 1 vulnerabilities: 1 critical, 0 high, 0 medium, 0 low",
		);
	});

	test("sums vulnerabilities across multi-project output (array shape)", () => {
		const input = JSON.stringify([
			{
				ok: false,
				vulnerabilities: [
					{
						id: "SNYK-A1",
						severity: "critical",
						title: "RCE",
						packageName: "foo",
						version: "1.0.0",
					},
					{
						id: "SNYK-A2",
						severity: "high",
						title: "SQLi",
						packageName: "bar",
						version: "1.0.0",
					},
				],
			},
			{
				ok: false,
				vulnerabilities: [
					{
						id: "SNYK-B1",
						severity: "high",
						title: "XSS",
						packageName: "baz",
						version: "1.0.0",
					},
					{
						id: "SNYK-B2",
						severity: "medium",
						title: "Info",
						packageName: "qux",
						version: "1.0.0",
					},
				],
			},
		]);

		const result = parseSnykOutput(input);

		expect(result.critical).toBe(1);
		expect(result.high).toBe(2);
		expect(result.medium).toBe(1);
		expect(result.low).toBe(0);
		expect(result.summary).toBe(
			"Found 4 vulnerabilities: 1 critical, 2 high, 1 medium, 0 low",
		);
	});

	test("multi-project output with all clean projects", () => {
		const input = JSON.stringify([
			{ ok: true, vulnerabilities: [] },
			{ ok: true, vulnerabilities: [] },
		]);

		const result = parseSnykOutput(input);

		expect(result.critical).toBe(0);
		expect(result.high).toBe(0);
		expect(result.summary).toBe("No vulnerabilities found");
	});
});
