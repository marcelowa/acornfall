import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/typography/text";
import { ClippedText } from "./clipped-text";

const meta = {
	title: "UI/ClippedText",
	component: ClippedText,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<Stack
				gap="sm"
				className="min-w-0 w-full max-w-xs rounded-md border border-border bg-card p-3"
			>
				<Story />
			</Stack>
		),
	],
} satisfies Meta<typeof ClippedText>;

export default meta;
type Story = StoryObj<typeof meta>;

const long = "mcp__playwright__browser_take_screenshot_full_page";

/** Narrower than the text: hover, focus or tap the name to read all of it. */
export const Clipped: Story = {
	args: { text: long, className: "font-mono text-sm" },
};

/** Wider than the text: no tooltip, because it would only repeat what is on screen. */
export const Fits: Story = {
	args: { text: "bash", className: "font-mono text-sm" },
};

/** The two side by side, as a card header would show them. */
export const Both: Story = {
	args: { text: long, className: "font-mono text-sm" },
	render: () => (
		<Stack gap="sm">
			<Text as="p" size="2xs" tone="muted">
				Clipped, with the rest on hover or tap
			</Text>
			<ClippedText text={long} className="font-mono text-sm" />
			<Text as="p" size="2xs" tone="muted">
				Whole, so nothing to show
			</Text>
			<ClippedText text="bun test" className="font-mono text-sm" />
		</Stack>
	),
};
