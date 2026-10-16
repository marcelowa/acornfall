import type { Meta, StoryObj } from "@storybook/react-vite";
import { Chart } from "./chart";

/**
 * A fence the model wrote, drawn when the reply settles.
 *
 * Storybook is the only place the drawing is visible: the unit tests cover the parse, and this
 * covers the picture — every bar starts in the same place, the longest is the longest, and every
 * number sits beside its own bar. The refused story is the other half: a fence the console cannot
 * read shows its source and one line saying why.
 */
const meta = {
	title: "Conversation/Chart",
	parameters: {
		docs: {
			description: {
				story: "One `name: number` per line, scaled to the longest bar. The whole fence has to parse: a chart that drops a line is a chart that lies, so anything else stays a code block.",
			},
		},
	},
	tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Drawn: Story = {
	render: () => (
		<div className="w-full max-w-2xl bg-background p-6">
			<Chart source={"passed: 184\nfailed: 6\nskipped: 1"} />
		</div>
	),
};

export const ManyBars: Story = {
	render: () => (
		<div className="w-full max-w-2xl bg-background p-6">
			<Chart
				source={[
					"markdown: 18",
					"tokens: 26",
					"layout: 14",
					"transcript: 63",
					"rail: 41",
					"settings: 22",
				].join("\n")}
			/>
		</div>
	),
};

export const Refused: Story = {
	render: () => (
		<div className="w-full max-w-2xl bg-background p-6">
			<Chart source={"the tests passed\nand it was quick"} />
		</div>
	),
};
