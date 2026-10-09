import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ThinkingEntry } from "@/app/view-models";
import { ThinkingCard } from "./thinking-card";

const meta = {
	title: "Conversation/ThinkingCard",
	component: ThinkingCard,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-full max-w-xl">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ThinkingCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const at = new Date(2026, 9, 6, 14, 32);

/** Still reasoning: open, with the live mark, no put-away button. */
export const Live: Story = {
	args: {
		entry: {
			kind: "thinking",
			id: "t-live",
			at,
			text: "Check the lock order first — the supervisor restarts on exit, so a second death announcement would race the first.",
			live: true,
		},
	},
};

/** Done: collapsed, with its length on the button. */
const doneText = [
	"The recovery path is idempotent, so the restart itself is safe.",
	"The bug is the announcement, not the restart.",
	"Read the supervisor before touching anything.",
	"Check the lock order first.",
	"Then look at who announced twice.",
	"Then fix the announcement, not the recovery.",
	"A death announced twice races itself on the way out.",
	"The second announcement is the one to delete.",
	"Keep the restart; it never hurt anyone.",
	"Keep the recovery; it is the correct shape.",
	"Verify with the workerpool tests before calling it done.",
	"Then update the changelog with one line.",
].join("\n");

export const Done: Story = {
	args: {
		entry: { kind: "thinking", id: "t-done", at, text: doneText },
	},
};

/** Done and opened: the whole reasoning, one click away. */
export const DoneExpanded: Story = {
	args: {
		entry: { ...(Done.args?.entry as ThinkingEntry), id: "t-open" },
		defaultExpanded: true,
	},
};
