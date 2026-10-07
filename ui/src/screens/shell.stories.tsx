import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ConversationSummary, TranscriptEntry } from "@/app/view-models";
import { ConversationList } from "@/components/conversation/conversation-list";
import { Stack } from "@/components/layout/stack";
import { Transcript } from "@/components/transcript/transcript";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Shell } from "./shell";

const meta = {
	title: "Screens/Shell",
	component: Shell,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Shell>;

export default meta;
type Story = StoryObj<typeof meta>;

const at = new Date(2026, 9, 6, 14, 32);

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

const entries: TranscriptEntry[] = [
	{ kind: "user", id: "1", at, text: "Why did the worker restart?" },
	{
		kind: "assistant",
		id: "2",
		at,
		markdown:
			"The supervisor saw the process exit and restarted it. The recovery path is\nidempotent, so the second death announcement was the bug.",
	},
	{
		kind: "tool",
		id: "3",
		at,
		name: "bash",
		status: "done",
		isError: false,
		args: { command: "go test ./internal/workerpool" },
		output: "ok  \tgithub.com/acornfall/acornfall/gateway/internal/workerpool\t0.21s",
	},
];

export const Assembled: Story = {
	args: {
		rail: (
			<div className="h-full border-r border-border bg-card p-2">
				<ConversationList conversations={conversations} deleted={[]} activeId="3" />
			</div>
		),
		transcript: (
			<div className="mx-auto w-full max-w-3xl">
				<Transcript entries={entries} />
			</div>
		),
		composer: (
			<Stack
				direction="horizontal"
				gap="sm"
				align="center"
				padding="md"
				className="border-t border-border"
			>
				<Button size="sm">Send</Button>
				<ThemeToggle theme="light" onToggle={() => undefined} />
			</Stack>
		),
	},
};

export const EmptyTranscript: Story = {
	args: {
		rail: (
			<div className="h-full border-r border-border bg-card p-2">
				<ConversationList
					conversations={conversations.slice(0, 1)}
					deleted={[]}
					activeId="1"
				/>
			</div>
		),
		transcript: <Transcript entries={[]} />,
		composer: (
			<Stack
				direction="horizontal"
				gap="sm"
				align="center"
				padding="md"
				className="border-t border-border"
			>
				<Button size="sm">Send</Button>
			</Stack>
		),
	},
};
