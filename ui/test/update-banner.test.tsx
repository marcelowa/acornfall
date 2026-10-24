import { test, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { UpdateStatus } from "../src/app/client";
import { UpdateBanner } from "../src/components/release/update-banner";

const status = (overrides: Partial<UpdateStatus> = {}): UpdateStatus => ({
	current: "v0.10.0-beta.46",
	latest: "v0.10.0-beta.47",
	notes: "",
	channel: "releases",
	autoCheck: true,
	checking: false,
	downloadSize: 0,
	workerSize: 0,
	available: true,
	backups: [],
	runsActive: false,
	runs: [],
	...overrides,
});

const noop = (): void => undefined;

test("a requested update says writes are paused", () => {
	const html = renderToStaticMarkup(
		<UpdateBanner
			status={status({
				phase: "requested",
				target: "v0.10.0-beta.47",
				blocking: true,
				phaseReason: "the host is preparing the machine",
			})}
			connection="live"
			onDetails={noop}
		/>,
	);
	expect(html).toContain("Updating to v0.10.0-beta.47");
	expect(html).toContain("Writes are paused");
});

test("a disconnected update says the machine is restarting", () => {
	const html = renderToStaticMarkup(
		<UpdateBanner
			status={status({
				phase: "starting",
				target: "v0.10.0-beta.47",
				blocking: true,
			})}
			connection="reconnecting"
			onDetails={noop}
		/>,
	);
	expect(html).toContain("machine is restarting");
});

test("a failed update carries the reason and no spinner", () => {
	const html = renderToStaticMarkup(
		<UpdateBanner
			status={status({
				phase: "failed",
				target: "v0.10.0-beta.47",
				blocking: false,
				phaseReason: "the host did not finish within 15 minutes",
			})}
			connection="live"
			onDetails={noop}
		/>,
	);
	expect(html).toContain("failed");
	expect(html).toContain("15 minutes");
});
