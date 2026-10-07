import type { Meta, StoryObj } from "@storybook/react-vite";
import { Shell } from "./shell";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { Code } from "@/components/typography/code";
import { Heading } from "@/components/typography/heading";
import { Text } from "@/components/typography/text";

const meta = {
	title: "Screens/Shell",
	component: Shell,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Shell>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The screen itself is classless; the placeholder slots in this story are stand-ins for what
 * #11 and #12 build, and they are the only place classes appear.
 */
export const Placeholder: Story = {
	args: {
		rail: (
			<Stack gap="sm" padding="md" fill className="border-r border-border bg-card">
				<Text weight="semibold">Conversations</Text>
				<Text size="sm" tone="muted">
					#11 builds the rail here.
				</Text>
			</Stack>
		),
		transcript: (
			<Stack gap="md">
				<Heading level={1}>The transcript</Heading>
				<Text tone="muted">
					#11 builds the transcript here, including its Formatted/Raw toggle and the copy
					button.
				</Text>
				<Text size="sm">
					Defaults resolve to <Code>provider/model</Code> until someone chooses otherwise.
				</Text>
			</Stack>
		),
		composer: (
			<Stack direction="horizontal" gap="sm" padding="md" className="border-t border-border">
				<Button size="sm">Send</Button>
			</Stack>
		),
	},
};
