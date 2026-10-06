import { readdir, readFile, stat } from "node:fs/promises";

/**
 * Reading files for resource loading: the workspace's own rules, skills, commands, and
 * agent definitions.
 *
 * It is an interface because of where the files are. The workspace lives inside the
 * sandbox, so the worker has no host path to it: those reads go through the sandbox. The
 * user's own folders (`~/.agents`, `<home>`) are not mounted into the sandbox at all, so
 * they come from the host. `routingFiles` decides which is which per path.
 */
export interface Files {
	/** File contents, or null when there is no such file. */
	read(path: string): Promise<string | null>;
	/** Directory entries, or none when there is no such directory. */
	list(path: string): Promise<DirEntry[]>;
	stat(path: string): Promise<FileStat | null>;
}

export interface DirEntry {
	name: string;
	directory: boolean;
	size: number;
	mtimeMs: number;
}

export interface FileStat {
	directory: boolean;
	size: number;
	mtimeMs: number;
}

/** The host's filesystem, for the folders the sandbox does not see. */
export const hostFiles: Files = {
	async read(path) {
		return await readFile(path, "utf8").catch(() => null);
	},
	async list(path) {
		const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
		return entries.map((entry) => ({ name: entry.name, directory: entry.isDirectory(), size: 0, mtimeMs: 0 }));
	},
	async stat(path) {
		const info = await stat(path).catch(() => null);
		if (info === null) return null;
		return { directory: info.isDirectory(), size: info.size, mtimeMs: info.mtimeMs };
	},
};

/**
 * Sends reads under `root` to the sandbox and everything else to the host.
 *
 * A prefix match on the string would answer for `/work-other` as well as `/work`, so the
 * comparison is on whole path components.
 */
export function routingFiles(root: string, sandbox: Files): Files {
	const prefix = root.endsWith("/") ? root : `${root}/`;
	const inside = (path: string) => path === root || path.startsWith(prefix);
	return {
		read: (path) => (inside(path) ? sandbox : hostFiles).read(path),
		list: (path) => (inside(path) ? sandbox : hostFiles).list(path),
		stat: (path) => (inside(path) ? sandbox : hostFiles).stat(path),
	};
}
