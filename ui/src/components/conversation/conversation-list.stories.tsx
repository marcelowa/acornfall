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
