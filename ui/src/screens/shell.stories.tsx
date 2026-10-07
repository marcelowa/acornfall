import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ConversationSummary, TranscriptEntry } from "@/app/view-models";
import { ConversationList } from "@/components/conversation/conversation-list";
import { Measure } from "@/components/layout/measure";
import { Stack } from "@/components/layout/stack";
import { Transcript } from "@/components/transcript/transcript";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Text } from "@/components/typography/text";
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

const rail = (
	<div className="h-full border-r border-border bg-card p-2">
		<ConversationList conversations={conversations} deleted={[]} activeId="3" />
	</div>
);

const barTitle = (
	<Text as="span" size="sm" weight="medium" className="truncate">
		The stream sends state views
	</Text>
);

const composer = (
	<div className="w-full border-t border-border">
		<Measure size="prose" padding="md">
			<Stack direction="horizontal" gap="sm" align="center">
				<Button size="sm">Send</Button>
				<ThemeToggle theme="light" onToggle={() => undefined} />
			</Stack>
		</Measure>
	</div>
);

const transcript = <Transcript entries={entries} />;
const args = { rail, transcript, composer, bar: barTitle };

export const Desktop: Story = { args };

/** Below `lg` the rail moves behind the toggle instead of eating the transcript's width. */
export const Phone: Story = {
	args,
	parameters: { viewport: { defaultViewport: "phone" } },
};

/** The drawer itself, held open. The app can control this when a selection closes it. */
export const PhoneRailOpen: Story = {
	args: { ...args, railOpen: true },
	parameters: { viewport: { defaultViewport: "phone" } },
};

/** From `2xl` up the empty margin becomes the inspector's home. */
export const Wide: Story = {
	args: {
		...args,
		inspector: (
			<div className="h-full border-l border-border bg-card p-4">
				<Stack gap="sm">
					<Text weight="semibold">Context</Text>
					<Text size="sm" tone="muted">
						The inspector arrives with #13: what the model sees, and which layer
						contributed what.
					</Text>
				</Stack>
			</div>
		),
	},
	parameters: { viewport: { defaultViewport: "wide" } },
};

export const EmptyTranscript: Story = {
	args: { ...args, rail: rail, transcript: <Transcript entries={[]} /> },
};
