import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkoutCommit, runCommand } from "./security-scan.ts";

describe("checkoutCommit (integration)", () => {
	let workDir: string;
	let bareDir: string;
	let seedDir: string;
	let commitSha: string;

	beforeEach(async () => {
		const root = await mkdtemp(join(tmpdir(), "checkout-test-"));
		bareDir = join(root, "bare.git");
		seedDir = join(root, "seed");
		workDir = join(root, "work");

		// Create a bare repo + seed it with one commit, then clone --no-checkout
		await runCommand("git", ["init", "--bare", bareDir]);
		await runCommand("git", ["clone", bareDir, seedDir]);
		await writeFile(join(seedDir, "README.txt"), "hello\n");
		await runCommand("git", ["-C", seedDir, "add", "README.txt"]);
		await runCommand("git", [
			"-C",
			seedDir,
			"-c",
			"user.email=t@t",
			"-c",
			"user.name=t",
			"commit",
			"-m",
			"seed",
		]);
		await runCommand("git", ["-C", seedDir, "push", "origin", "HEAD:main"]);
		const rev = await runCommand("git", ["-C", seedDir, "rev-parse", "HEAD"]);
		commitSha = rev.stdout.trim();

		await runCommand("git", ["clone", "--no-checkout", bareDir, workDir]);
	});

	afterEach(async () => {
		for (const d of [workDir, seedDir, bareDir]) {
			if (d) await rm(d, { recursive: true, force: true }).catch(() => {});
		}
	});

	test("populates the working tree at the target commit", async () => {
		expect(existsSync(join(workDir, "README.txt"))).toBe(false);

		await checkoutCommit(workDir, commitSha);

		expect(existsSync(join(workDir, "README.txt"))).toBe(true);
	});
});
