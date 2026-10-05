/**
 * Scratch directories that are removed when the file's tests finish.
 *
 * `mkdtemp` on its own leaves a directory behind per test per run: 384 of them had
 * accumulated in `/tmp` before anyone looked, and the suite had been run a few dozen times.
 * A test is a function of its inputs and it leaves the machine as it found it.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const created: string[] = [];

/** A temp directory for one test, cleaned up by `cleanupScratch` at the end of the file. */
export async function tempDir(prefix = "acornfall-test-"): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	created.push(dir);
	return dir;
}

/** Write a file, creating its parent directories. Three test files had a copy of this. */
export async function write(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content);
}

/** Register with `afterAll(cleanupScratch)` in every file that calls `tempDir`. */
export async function cleanupScratch(): Promise<void> {
	await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}
