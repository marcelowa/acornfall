import { expect, test } from "bun:test";
import { routeFromUrl } from "@/app/use-platform";

/**
 * The URL scheme, as one function. The workspaces list is the case worth a test: it was a page
 * (`/workspaces`) until step 09 made it a layer with no address of its own, and an old link has
 * to land on the conversation rather than on nothing.
 */

test("the workspaces list is no longer an address", () => {
	expect(routeFromUrl("/workspaces", "")).toEqual({
		screen: "conversation",
		workspace: "",
		conversation: "",
		settingsTab: "defaults",
		updateTag: "",
	});
});

test("a conversation URL keeps its workspace and its id", () => {
	expect(routeFromUrl("/c/acornfall/abcd-1234", "")).toEqual({
		screen: "conversation",
		workspace: "acornfall",
		conversation: "abcd-1234",
		settingsTab: "defaults",
		updateTag: "",
	});
});

test("a workspace URL is a conversation with no id yet", () => {
	expect(routeFromUrl("/w/spikes", "")).toEqual({
		screen: "conversation",
		workspace: "spikes",
		conversation: "",
		settingsTab: "defaults",
		updateTag: "",
	});
});

test("settings keeps its page and the workspace it was about", () => {
	expect(routeFromUrl("/settings/providers", "?workspace=spikes")).toEqual({
		screen: "settings",
		workspace: "spikes",
		conversation: "",
		settingsTab: "providers",
		updateTag: "",
	});
});

test("an unknown settings page lands on defaults", () => {
	expect(routeFromUrl("/settings/nope", "").settingsTab).toBe("defaults");
});

// The release page replaced the Updates tab, and the owner chose no redirect: an old link
// lands on the install page's sibling, defaults, like any unknown settings page.
test("the old updates tab is gone, with no redirect", () => {
	expect(routeFromUrl("/settings/updates", "").settingsTab).toBe("defaults");
});

test("the release page is its own address, and a version has its own too", () => {
	expect(routeFromUrl("/update", "?workspace=spikes")).toEqual({
		screen: "update",
		workspace: "spikes",
		conversation: "",
		settingsTab: "defaults",
		updateTag: "",
	});
	expect(routeFromUrl("/update/v0.9.28", "?workspace=spikes")).toEqual({
		screen: "update",
		workspace: "spikes",
		conversation: "",
		settingsTab: "defaults",
		updateTag: "v0.9.28",
	});
});

test("the install-wide settings page has its own URL", () => {
	expect(routeFromUrl("/settings/install", "?workspace=spikes").settingsTab).toBe("install");
});
