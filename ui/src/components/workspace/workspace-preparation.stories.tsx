import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspacePreparationRow } from "./workspace-preparation";

const meta = {
	title: "Layout/WorkspacePreparation",
	component: WorkspacePreparationRow,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="flex w-80 flex-col gap-2 bg-rail p-2">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof WorkspacePreparationRow>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;
const startedAt = Date.now() - 12_000;

/** The wait: the current conversation is untouched, and the row says what is happening. */
export const Preparing: Story = {
	args: {
		preparation: { name: "new-one", phase: "preparing", startedAt },
		onOpen: noop,
		onDismiss: noop,
		onRetry: noop,
	},
};

/** Ready is a state: the row stays until the person opens it or dismisses it. */
export const Ready: Story = {
	args: {
		preparation: { name: "new-one", phase: "ready", startedAt },
		onOpen: noop,
		onDismiss: noop,
		onRetry: noop,
	},
};

/** A failure keeps the gateway's own words, and offers the retry. */
export const Failed: Story = {
	args: {
		preparation: {
			name: "new-one",
			phase: "failed",
			startedAt,
			reason: "the harness process ended: signal: killed",
		},
		onOpen: noop,
		onDismiss: noop,
		onRetry: noop,
	},
};
