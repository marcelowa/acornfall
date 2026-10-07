import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusPill } from "./status-pill";

const meta = {
	title: "UI/StatusPill",
	component: StatusPill,
	parameters: { layout: "centered" },
} satisfies Meta<typeof StatusPill>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The stream dropped; the app keeps working from the last state it saw. */
export const Reconnecting: Story = {
	args: { state: "reconnecting" },
};

/** The harness is gone, and the reason travels with it. */
export const HarnessDown: Story = {
	args: { state: "harness-down", detail: "the harness process ended: signal: killed" },
};
