import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ConversationSummary } from "@/app/view-models";
import { ConversationRow } from "./conversation-row";

const meta = {
	title: "Conversation/ConversationRow",
	component: ConversationRow,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-80 rounded-md border border-border bg-background p-2">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ConversationRow>;

export default meta;
type Story = StoryObj<typeof meta>;

const base: ConversationSummary = {
	id: "3",
	title: "The stream sends state views",
	root: false,
	hidden: false,
	running: false,
	unread: false,
	tokens: 0,
	cost: 0,
	updatedAt: new Date(Date.now() - 2 * 60 * 60_000),
};

export const Default: Story = { args: { conversation: base } };
export const Active: Story = { args: { conversation: base, active: true } };
export const Running: Story = { args: { conversation: { ...base, running: true } } };
export const Unread: Story = { args: { conversation: { ...base, unread: true } } };
export const Root: Story = { args: { conversation: { ...base, root: true } } };
export const Peer: Story = { args: { conversation: { ...base, createdBy: "1", running: true } } };
export const Tombstoned: Story = { args: { conversation: { ...base, hidden: true } } };
/** Spend and when it moved are on the row now: hovering is not a gesture a phone has. */
export const SpendOnTheRow: Story = {
	args: { conversation: { ...base, tokens: 12400, cost: 0.0432 } },
};

/** A run that moved just now: the dot keeps its accent, the line says how fresh it is. */
export const RunningFresh: Story = {
	args: {
		conversation: {
			...base,
			running: true,
			tokens: 48900,
			cost: 0.1902,
			updatedAt: new Date(Date.now() - 30_000),
		},
	},
};

/**
 * A run that stopped moving: the dot drops its accent and the line carries the time, so the
 * rail stops promising a run that is not happening.
 */
export const RunningStale: Story = {
	args: {
		conversation: {
			...base,
			running: true,
			tokens: 48900,
			cost: 0.1902,
			updatedAt: new Date(Date.now() - 38 * 60_000),
		},
	},
};

export const LongTitle: Story = {
	args: {
		conversation: {
			...base,
			title: "A conversation whose title runs past the width of the rail and truncates",
		},
	},
};
