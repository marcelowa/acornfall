import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/typography/text";
import { Shell } from "./shell";

const meta = {
	title: "Layout/Shell",
	component: Shell,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Shell>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Shell is the frame and nothing else: slots in, layout out. The composition that fills the
 * slots with real components is `Screens/Workspace`; this story is the contract, not the
 * product.
 */
const pane = (title: string, note: string) => (
	<Stack gap="sm" padding="lg" fill>
		<Text weight="semibold">{title}</Text>
		<Text size="sm" tone="muted">
			{note}
		</Text>
	</Stack>
);

export const Slots: Story = {
	args: {
		rail: (
			<div className="h-full border-r border-border bg-card p-2">
				<Text size="sm" weight="semibold">
					rail
				</Text>
			</div>
		),
		bar: <Text size="sm">conversation title</Text>,
		transcript: pane("transcript", "A scroll region that owns its own height."),
		composer: (
			<div className="w-full border-t border-border">
				<Stack gap="sm" padding="md">
					<Text size="sm" tone="muted">
						composer
					</Text>
				</Stack>
			</div>
		),
	},
};
