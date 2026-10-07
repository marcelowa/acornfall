import type { Meta, StoryObj } from "@storybook/react-vite";
import { ErrorStrip } from "./error-strip";

const meta = {
	title: "UI/ErrorStrip",
	component: ErrorStrip,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-96">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ErrorStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

/** The refusal is the server's sentence, not a generic apology. */
export const Refused: Story = {
	args: {
		message: 'a workspace name cannot contain a slash or a space: "ui-check/refused"',
		onDismiss: noop,
	},
};

export const Long: Story = {
	args: {
		message:
			"the provider refused the request: rate limited until 18:42 UTC; the conversation is intact and the turn can be retried",
		onDismiss: noop,
	},
};
