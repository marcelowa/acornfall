import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@/components/layout/stack";
import { SettingsOutcome } from "./settings-outcome";

const meta = {
	title: "UI/SettingsOutcome",
	component: SettingsOutcome,
	parameters: { layout: "centered" },
	// The field's own line, in its place: under a label and a control, as a page shows it.
	decorators: [
		(Story) => (
			<Stack gap="sm" className="w-full max-w-sm rounded-lg border border-border bg-card p-3">
				<Story />
			</Stack>
		),
	],
} satisfies Meta<typeof SettingsOutcome>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Asked for, not answered yet. */
export const Pending: Story = { args: { state: "pending" } };

/** Landed: the value the server holds is the one the field sent. */
export const Applied: Story = { args: { state: "applied" } };

/** Refused, in the server's own words, beside the value that was refused. */
export const Refused: Story = { args: { state: "refused", message: "no image by that name" } };
