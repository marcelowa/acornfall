import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Page } from "./page";
import { Split } from "./split";
import { Stack } from "./stack";
import { Text } from "../typography/text";

const meta = {
	title: "Layout/Split",
	component: Split,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<Page>
				<Story />
			</Page>
		),
	],
} satisfies Meta<typeof Split>;

export default meta;
type Story = StoryObj<typeof meta>;

const aside = (
	<Stack gap="sm" padding="md" fill className="border-r border-border bg-card">
		<Text weight="semibold">The rail</Text>
		<Text size="sm" tone="muted">
			Fixed at --rail-width from lg up; behind the toggle below that.
		</Text>
	</Stack>
);

const main = (
	<Stack gap="sm" padding="lg" fill>
		<Text weight="semibold">The pane beside it</Text>
		<Text size="sm" tone="muted">
			The only part that grows. Below lg the rail is not in the grid at all.
		</Text>
	</Stack>
);

export const Desktop: Story = {
	args: { aside, children: main },
	globals: { viewport: { value: "laptop" } },
};

/** Phone: the rail is behind the toggle in the bar, and the middle pane is the whole screen. */
export const Phone: Story = {
	args: { aside, bar: <Text size="sm">Conversation</Text>, children: main },
	globals: { viewport: { value: "phone" } },
};

function ResizableFrame() {
	const [width, setWidth] = useState<number | undefined>(undefined);
	return (
		<Page>
			<Split
				aside={aside}
				asideWidth={width}
				onAsideWidthChange={setWidth}
				bar={<Text size="sm">Drag the edge of the rail</Text>}
			>
				{main}
			</Split>
		</Page>
	);
}

/** The handle between the panes: drag it, or focus it and use the arrow keys. */
export const Resizable: Story = {
	args: { aside, children: main },
	render: () => <ResizableFrame />,
};
