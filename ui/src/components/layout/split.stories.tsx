import type { Meta, StoryObj } from "@storybook/react-vite";
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

const inspector = (
	<Stack gap="sm" padding="lg" fill className="border-l border-border bg-card">
		<Text weight="semibold">The inspector</Text>
		<Text size="sm" tone="muted">
			From 2xl up, when Split is given one.
		</Text>
	</Stack>
);

export const Desktop: Story = {
	args: { aside, children: main },
	parameters: { viewport: { defaultViewport: "laptop" } },
};

export const WithInspector: Story = {
	args: { aside, end: inspector, children: main },
	parameters: { viewport: { defaultViewport: "wide" } },
};

/** Phone: the rail is behind the toggle in the bar, and the middle pane is the whole screen. */
export const Phone: Story = {
	args: { aside, bar: <Text size="sm">Conversation</Text>, children: main },
	parameters: { viewport: { defaultViewport: "phone" } },
};
