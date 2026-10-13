/**
 * The install's own identity, for the sign-ins that identify the app to the provider: OpenAI's
 * ChatGPT login sends the id as the agent host id, and refuses to start without one.
 *
 * Created on the first sign-in and stable from then on. The provider's contract is that later
 * calls return the same value — an id that changed per run would read as a new app every time —
 * so it lives in the install's home rather than in memory.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** The file the id lives in, under the install's home. */
export function installIdPath(home: string): string {
	return join(home, "device-id");
}

export async function installId(home: string): Promise<string> {
	const path = installIdPath(home);
	try {
		const existing = (await readFile(path, "utf8")).trim();
		if (existing !== "") return existing;
	} catch {
		// The normal first run. An unreadable file is treated as a missing one: a sign-in that
		// cannot start is worse than a new id.
	}
	const created = crypto.randomUUID();
	await writeFile(path, `${created}\n`, { mode: 0o600 });
	return created;
}
