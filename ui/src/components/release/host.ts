import type { UpdateStatus } from "@/app/client";

/**
 * What the host service says about the machine, in one sentence (ADR 0030): the release running, the
 * one that was asked for, and what failed. Empty when there is no host and nothing asked for — a
 * console on a host install updates itself and has nothing to show here.
 *
 * It is a function rather than three lines in the screen because the sentence is the fact: the same
 * two versions in a different order say a different thing, and a table is how that stays true.
 */
export function hostSentence(wanted: string, host: UpdateStatus["host"]): string {
	const asked = wanted === "" ? "" : wanted;
	if (host === undefined) {
		return asked === "" ? "" : `${asked} was asked for, and no host has answered yet.`;
	}
	const running = host.version === "" ? "nothing is running" : `${host.version} is running`;
	if (host.lastError !== "") {
		return `${running}, and the host could not apply ${asked === "" ? "the release" : asked}: ${host.lastError}`;
	}
	if (asked !== "" && asked !== host.version) {
		return `${running}; the host was asked for ${asked}.`;
	}
	return `${running}.`;
}
