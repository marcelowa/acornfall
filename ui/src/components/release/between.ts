import type { UpdateRelease } from "@/app/client";

/**
 * The "changes in between" selection, on its own so a test can hold it without a
 * DOM: which releases the page lists between the running build and the target,
 * and which tags its single notes read asks for.
 */

/** How many releases the in-between list may hold: the window's own size. */
export const BETWEEN_LIMIT = 20;

/**
 * The releases between the running build and the target: the list's rows whose
 * relation says newer, the target itself out, newest first, capped at the window.
 */
export function betweenReleases(
	releases: UpdateRelease[] | undefined,
	targetTag: string,
	targetIsNewer: boolean,
): UpdateRelease[] {
	if (releases === undefined || !targetIsNewer) return [];
	return releases
		.filter((release) => release.relation === "newer" && release.tag !== targetTag)
		.slice(0, BETWEEN_LIMIT);
}

/**
 * The tags the one notes read asks for: everything in between. The target's own
 * notes ride its by-name read, so asking for it here would be a second read for
 * the same words.
 */
export function notesTags(between: UpdateRelease[]): string[] {
	return between.map((release) => release.tag).filter((tag) => tag !== "");
}
