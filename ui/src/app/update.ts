/**
 * The running build, tracked across update polls and stream states: which
 * version this page first saw, and whether a newer sighting means reload.
 * Pure, so the rule is tested without a browser.
 */
export interface BuildTrack {
	seen: string | undefined;
	reload: boolean;
}

/**
 * First sight sets the baseline and never reloads. An empty sighting says
 * nothing either way. Only a different build reloads: an apply or a
 * rollback swapped the binary under this page, and this bundle is old.
 */
export function trackBuild(seen: string | undefined, current: string | undefined): BuildTrack {
	if (current === undefined || current === "") return { seen, reload: false };
	if (seen === undefined || seen === "") return { seen: current, reload: false };
	return { seen, reload: seen !== current };
}
