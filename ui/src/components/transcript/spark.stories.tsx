import type { Meta, StoryObj } from "@storybook/react-vite";
import { Spark } from "./spark";

/**
 * A fence the model wrote, drawn when the reply settles.
 *
 * Storybook is the only place the drawing is visible: the unit tests cover the parse, and this
 * covers the picture — the line rises and falls with the numbers, and the two ends carry the two
 * values the shape is about. The refused story is the other half.
 */
const meta = {
	title: "Conversation/Spark",
	parameters: {
		layout: "centered",
		docs: {
			description: {
				story: "Numbers in a line, separated by spaces, commas or newlines. Three at least, sixty at most, and every one of them a number — anything else stays a code block.",
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
			<Spark source={"3 5 4 9 8 12 11 14"} />
		</div>
	),
};

/** Numbers that come back down read the same way up. */
export const Falling: Story = {
	render: () => (
		<div className="w-full max-w-2xl bg-background p-6">
			<Spark source={"42 38 39 31 22 18 9 6"} />
		</div>
	),
};

/** Nothing moved: the line is flat, through the middle, rather than on the floor of the box. */
export const Flat: Story = {
	render: () => (
		<div className="w-full max-w-2xl bg-background p-6">
			<Spark source={"7 7 7 7 7"} />
		</div>
	),
};

export const Refused: Story = {
	render: () => (
		<div className="w-full max-w-2xl bg-background p-6">
			<Spark source={"3 5 lots 9"} />
		</div>
	),
};
