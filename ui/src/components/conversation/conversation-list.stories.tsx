import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ConversationSummary } from "@/app/view-models";
import { ConversationList } from "./conversation-list";

const meta = {
	title: "Conversation/ConversationList",
	component: ConversationList,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-80 rounded-md border border-border bg-background p-2">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ConversationList>;

export default meta;
type Story = StoryObj<typeof meta>;

const conversations: ConversationSummary[] = [
	{
		id: "1",
		title: "Workspace defaults",
		root: true,
		hidden: false,
		running: false,
		unread: false,
		tokens: 4200,
		cost: 0.0121,
	},
	{
		id: "3",
		title: "The stream sends state views",
		root: false,
		hidden: false,
		running: true,
		unread: false,
		tokens: 12400,
		cost: 0.0432,
	},
	{
		id: "4",
		title: "Migration review",
		root: false,
		hidden: false,
		running: false,
		unread: true,
		createdBy: "1",
		tokens: 0,
		cost: 0,
	},
];

const deleted: ConversationSummary[] = [
	{
		id: "2",
		title: "Old sandbox attempt",
		root: false,
		hidden: true,
		running: false,
		unread: false,
		tokens: 900,
		cost: 0.002,
	},
];

export const Mixed: Story = { args: { conversations, deleted, activeId: "3" } };
export const Empty: Story = { args: { conversations: [], deleted: [] } };
export const WithoutDeleted: Story = { args: { conversations, deleted: [] } };

const now = new Date(2026, 9, 8, 14, 32);
const day = 86_400_000;

/** Date groups appear once the gateway provides `updatedAt`; undated rows render flat above them. */
export const Grouped: Story = {
	args: {
		conversations: [
			{ ...conversations[0]!, updatedAt: now },
			{ ...conversations[1]!, updatedAt: new Date(now.getTime() - day) },
			{ ...conversations[2]!, updatedAt: new Date(now.getTime() - 3 * day) },
			{
				id: "5",
				title: "Old migration notes",
				root: false,
				hidden: false,
				running: false,
				unread: false,
				tokens: 300,
				cost: 0.001,
				updatedAt: new Date(now.getTime() - 30 * day),
			},
		],
		deleted,
		activeId: "3",
	},
};
