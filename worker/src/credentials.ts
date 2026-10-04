/**
 * File-backed CredentialStore. See docs/adr/0003-provider-credentials.md.
 *
 * The file is exactly a pi-ai credential map: `{ [providerId]: Credential }`.
 * Go writes api keys into it; the worker reads it and performs locked
 * read-modify-write for refresh, so two workers sharing the file cannot
 * double-refresh a rotated token.
 */
import { constants } from "node:fs";
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import type {
	AuthOperationOptions,
	Credential,
	CredentialInfo,
	CredentialStore,
} from "@earendil-works/pi-ai";

const LOCK_TIMEOUT_MS = 30_000;
const LOCK_STALE_MS = 60_000;

export class FileCredentialStore implements CredentialStore {
	#path: string;
	#chains = new Map<string, Promise<unknown>>();
	#readCache: { mtimeMs: number; value: Record<string, Credential> } | undefined;

	constructor(path: string) {
		this.#path = path;
	}

	async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
		options?.signal?.throwIfAborted();
		const all = await this.#readAll(true);
		const credential = all[providerId];
		return credential === undefined ? undefined : structuredClone(credential);
	}

	async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		options?.signal?.throwIfAborted();
		const all = await this.#readAll(true);
		return Object.entries(all).map(([providerId, credential]) => ({
			providerId,
			type: credential.type,
		}));
	}

	async modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		const previous = this.#chains.get(providerId) ?? Promise.resolve();
		const queued = (async () => {
			await previous.catch(() => {});
			options?.signal?.throwIfAborted();
			return this.#withLock(async () => {
				const all = await this.#readAll(true);
				const current = all[providerId];
				const next = await fn(current === undefined ? undefined : structuredClone(current));
				if (next !== undefined) {
					all[providerId] = next;
					await this.#writeAll(all);
				}
				return next;
			});
		})();
		const tail = queued.catch(() => {});
		this.#chains.set(providerId, tail);
		void tail.then(() => {
			if (this.#chains.get(providerId) === tail) this.#chains.delete(providerId);
		});
		return queued;
	}

	async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
		await this.modify(
			providerId,
			async () => undefined,
			options,
		).catch(() => undefined);
		await this.#withLock(async () => {
			const all = await this.#readAll(true);
			if (providerId in all) {
				delete all[providerId];
				await this.#writeAll(all);
			}
		});
	}

	async #readAll(fresh: boolean): Promise<Record<string, Credential>> {
		if (!fresh && this.#readCache !== undefined) return this.#readCache.value;
		let text: string;
		try {
			text = await readFile(this.#path, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
			throw error;
		}
		if (text.trim().length === 0) return {};
		try {
			const parsed = JSON.parse(text) as Record<string, Credential>;
			return parsed !== null && typeof parsed === "object" ? parsed : {};
		} catch {
			throw new Error(`credentials file is not valid JSON: ${this.#path}`);
		}
	}

	async #writeAll(all: Record<string, Credential>): Promise<void> {
		const temp = `${this.#path}.${process.pid}.tmp`;
		await writeFile(temp, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
		await rename(temp, this.#path);
	}

	/** Exclusive-create lock file with retry, so cross-process modify is serialized. */
	async #withLock<T>(task: () => Promise<T>): Promise<T> {
		const lockPath = `${this.#path}.lock`;
		const deadline = Date.now() + LOCK_TIMEOUT_MS;
		let handle: Awaited<ReturnType<typeof open>> | undefined;
		for (;;) {
			try {
				handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
				break;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				if (Date.now() > deadline) throw new Error(`credentials lock timeout: ${lockPath}`);
				try {
					const stat = await (await open(lockPath, "r")).stat();
					if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) await unlink(lockPath);
				} catch {
					// Another process released it; retry immediately.
				}
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
		}
		try {
			return await task();
		} finally {
			await handle.close();
			await unlink(lockPath).catch(() => undefined);
		}
	}
}
