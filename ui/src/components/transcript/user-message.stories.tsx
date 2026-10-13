import type { Meta, StoryObj } from "@storybook/react-vite";
import { UserMessage } from "./user-message";

const meta = {
	title: "Conversation/UserMessage",
	component: UserMessage,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="flex w-full max-w-2xl flex-col bg-background p-4">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof UserMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

const at = new Date(Date.now() - 12 * 60_000);

/** Your own words, exactly as typed, in your own bubble. */
export const OwnWords: Story = {
	args: {
		entry: {
			kind: "user",
			id: "1",
			text: "The rail keeps the wrong workspace's conversations after a switch — can you look?",
			at,
		},
	},
};

/** A message that can be branched from: the control only exists where the server offers it. */
export const Branchable: Story = {
	args: {
		entry: {
			kind: "user",
			id: "2",
			text: "Take the token route, not the raw grey.",
			at,
			forkAt: "entry-2",
		},
	},
};

/** Another conversation's words. They are not yours, so they get a card and a way back. */
export const PeerReport: Story = {
	args: {
		entry: {
			kind: "user",
			id: "3",
			text: "[from subagent rail-scan] The 30-minute flag keeps a dead run's dot lit.",
			at,
			sender: { kind: "report", name: "rail-scan", conversationId: "7" },
		},
		onOpenConversation: () => undefined,
	},
};

/** A peer asking rather than reporting: a subagent's question, with the prefix hidden. */
export const PeerAsk: Story = {
	args: {
		entry: {
			kind: "user",
			id: "4",
			text: "[from conversation 12] Which sandbox image should I test against?",
			at,
			sender: { kind: "ask", conversationId: "12" },
		},
		onOpenConversation: () => undefined,
	},
};

/**
 * Sent while a turn was running: the mark says whether it joined that turn or waited behind it.
 * It is claimed by the app as the message lands, because the wire keeps no link between the
 * inbox item and the entry it becomes.
 */
export const Steered: Story = {
	args: {
		entry: {
			kind: "user",
			id: "5",
			text: "wait, check the lock order first",
			at,
			action: "steer",
		},
	},
};

export const Queued: Story = {
	args: {
		entry: {
			kind: "user",
			id: "6",
			text: "then update the changelog",
			at,
			action: "followUp",
		},
	},
};

/**
 * One unbroken word, a hundred characters long: a pasted token, a hash, a data URL. Prose wraps
 * anywhere (`wrap-anywhere`), and the transcript clips its own width, so a long word cannot drag
 * the whole console sideways — before this, a pasted PAT scrolled the app.
 */
export const LongToken: Story = {
	args: {
		entry: {
			kind: "user",
			id: "long-token",
			text: "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",
			at,
		},
	},
	globals: { viewport: { value: "phone" } },
};
