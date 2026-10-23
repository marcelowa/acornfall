import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceWakeNotice } from "./workspace-wake-notice";

const meta = {
	title: "Layout/WorkspaceWakeNotice",
	component: WorkspaceWakeNotice,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-full max-w-2xl bg-background p-3">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof WorkspaceWakeNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Waking: Story = {
	args: { name: "marc-02" },
};
