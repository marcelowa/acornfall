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
	});
});

test("a conversation URL keeps its workspace and its id", () => {
	expect(routeFromUrl("/c/acornfall/abcd-1234", "")).toEqual({
		screen: "conversation",
		workspace: "acornfall",
		conversation: "abcd-1234",
		settingsTab: "defaults",
	});
});

test("a workspace URL is a conversation with no id yet", () => {
	expect(routeFromUrl("/w/spikes", "")).toEqual({
		screen: "conversation",
		workspace: "spikes",
		conversation: "",
		settingsTab: "defaults",
	});
});

test("settings keeps its page and the workspace it was about", () => {
	expect(routeFromUrl("/settings/providers", "?workspace=spikes")).toEqual({
		screen: "settings",
		workspace: "spikes",
		conversation: "",
		settingsTab: "providers",
	});
});

test("an unknown settings page lands on defaults", () => {
	expect(routeFromUrl("/settings/nope", "").settingsTab).toBe("defaults");
});
