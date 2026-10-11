import type { Meta, StoryObj } from "@storybook/react-vite";
import type { SummaryEntry } from "@/app/view-models";
import { SummaryCard } from "./summary-card";

const meta = {
	title: "Conversation/SummaryCard",
	component: SummaryCard,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-full max-w-xl">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof SummaryCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const at = new Date(2026, 9, 6, 14, 32);

const note = [
	"## Work so far",
	"",
	"- The supervisor restarts the worker on exit; the restart itself is safe.",
	"- The bug is the death announced twice: the second races the first.",
	"",
	"## Open",
	"",
	"- Read the supervisor before touching anything.",
	"- Fix the announcement, not the recovery.",
	"",
	"## Next",
	"",
	"- Verify with the workerpool tests, then update the changelog.",
].join("\n");

/** Put away: the talk moved on, the note stays one click away. */
export const Collapsed: Story = {
	args: {
		entry: { kind: "summary", id: "s-1", at, markdown: note },
	},
};

/** Open: the whole note. */
export const Expanded: Story = {
	args: {
		entry: { ...(Collapsed.args?.entry as SummaryEntry), id: "s-2" },
		defaultExpanded: true,
	},
};

/** A short note stays open with no button: put-away for two lines is noise. */
export const Short: Story = {
	args: {
		entry: { kind: "summary", id: "s-3", at, markdown: "Fixed the announcement. Tests green." },
	},
};
