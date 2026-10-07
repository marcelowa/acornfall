import type { Meta, StoryObj } from "@storybook/react-vite";
import { Page } from "./page";
import { Stack } from "./stack";
import { Heading } from "../typography/heading";
import { Text } from "../typography/text";

const meta = {
	title: "Layout/Page",
	component: Page,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Surface: Story = {
	args: {
		children: (
			<Stack gap="sm" padding="lg" fill>
				<Heading level={3}>The root surface</Heading>
				<Text tone="muted">
					Background, foreground, and full height come from the theme here, once.
				</Text>
			</Stack>
		),
	},
};
