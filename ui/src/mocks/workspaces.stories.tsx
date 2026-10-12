import type { Meta, StoryObj } from "@storybook/react-vite";
import { MockFrame } from "./frame";
import { MockWorkspaceRow } from "./workspaces";

const meta = {
	title: "Mocks/Workspaces — a running row",
	parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Rows: Story = {
	render: () => (
		<MockFrame
			label="The workspace row says whether anything is running in it"
			note="Panel finding (J2, TINKERER): `running` is mapped and never rendered, so checking on another workspace means opening it. The mark reuses the rail's dot language, and the row wraps so nothing runs off a phone."
		>
			<div className="flex flex-col gap-2">
				<MockWorkspaceRow
					name="acornfall"
					path="~/acornfall/workspaces/acronfall"
					running
					inView
				/>
				<MockWorkspaceRow name="marcelo-site" path="~/sites/marcelo" />
				<MockWorkspaceRow name="scratch" path="~/scratch" />
			</div>
		</MockFrame>
	),
};

export const Phone: Story = {
	render: () => (
		<MockFrame
			label="The same rows on a phone"
			note="What changed after the review: below `sm` the controls drop to their own line instead of the row growing past the screen. A long path truncates rather than pushing the controls out."
			width="phone"
		>
			<div className="flex flex-col gap-2">
				<MockWorkspaceRow
					name="acornfall"
					path="~/acornfall/workspaces/acronfall"
					running
					inView
				/>
				<MockWorkspaceRow
					name="a-workspace-with-a-long-name"
					path="~/sites/a-workspace-with-a-long-name"
				/>
			</div>
		</MockFrame>
	),
};
