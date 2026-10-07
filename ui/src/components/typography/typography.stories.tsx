import type { Meta, StoryObj } from "@storybook/react-vite";
import { Code } from "./code";
import { Heading } from "./heading";
import { Text } from "./text";

const meta = {
	title: "Foundations/Typography",
	parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Scale: Story = {
	render: () => (
		<div className="flex max-w-xl flex-col gap-4 p-8">
			<Heading level={1}>Heading one</Heading>
			<Heading level={2}>Heading two</Heading>
			<Heading level={3}>Heading three</Heading>
			<Heading level={4}>Heading four</Heading>
			<Text size="lg">Text lg — lead paragraphs and the opening line of a view.</Text>
			<Text size="base">Text base — the default for everything a person reads.</Text>
			<Text size="sm" tone="muted">
				Text sm muted — captions, secondary lines, metadata.
			</Text>
			<Text size="xs" tone="muted">
				Text xs muted — the smallest label that is still text.
			</Text>
			<Text size="2xs" tone="muted">
				Text 2xs muted — timestamps and dense metadata.
			</Text>
			<Text>
				Inline <Code>conversation.id</Code> renders as code.
			</Text>
		</div>
	),
};
