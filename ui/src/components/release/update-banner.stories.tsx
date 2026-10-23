import type { Meta, StoryObj } from "@storybook/react-vite";
import type { UpdateStatus } from "@/app/client";
import { UpdateBanner } from "./update-banner";

const meta = {
	title: "Layout/UpdateBanner",
	component: UpdateBanner,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-full max-w-2xl bg-background p-3">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof UpdateBanner>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

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

export const Requested: Story = {
	args: {
		status: status({
			phase: "requested",
			target: "v0.10.0-beta.47",
			blocking: true,
			phaseReason: "the host is preparing the machine",
		}),
		connection: "live",
		onDetails: noop,
	},
};

/** The old console is gone; the new one has not answered yet. */
export const Reconnecting: Story = {
	args: {
		status: status({
			phase: "starting",
			target: "v0.10.0-beta.47",
			blocking: true,
			phaseReason: "the new machine is starting",
		}),
		connection: "reconnecting",
		onDetails: noop,
	},
};

/** The new console is up; the host has not taken its own binary yet. */
export const Starting: Story = {
	args: {
		status: status({
			phase: "starting",
			target: "v0.10.0-beta.47",
			blocking: true,
			phaseReason: "the new machine is starting",
		}),
		connection: "live",
		onDetails: noop,
	},
};

export const Failed: Story = {
	args: {
		status: status({
			phase: "failed",
			target: "v0.10.0-beta.47",
			blocking: false,
			phaseReason: "the host did not finish within 15 minutes",
		}),
		connection: "live",
		onDetails: noop,
	},
};
