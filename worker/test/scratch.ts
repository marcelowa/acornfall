/**
 * Scratch directories that are removed when the file's tests finish.
 *
 * `mkdtemp` on its own leaves a directory behind per test per run: 384 of them had
 * accumulated in `/tmp` before anyone looked, and the suite had been run a few dozen times.
 * A test is a function of its inputs and it leaves the machine as it found it.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const created: string[] = [];

/** A temp directory for one test, cleaned up by `cleanupScratch` at the end of the file. */
export async function tempDir(prefix = "acornfall-test-"): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	created.push(dir);
	return dir;
}

/** Register with `afterAll(cleanupScratch)` in every file that calls `tempDir`. */
export async function cleanupScratch(): Promise<void> {
	await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}
