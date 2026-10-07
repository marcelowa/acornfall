import type { Meta, StoryObj } from "@storybook/react-vite";
import { foldContext } from "./context";
import type { Platform } from "./use-platform";
import type { ConversationSummary, TranscriptEntry } from "./view-models";
import { WorkspaceView } from "./workspace-view";

const meta = {
	title: "Screens/Workspace",
	component: WorkspaceView,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WorkspaceView>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;
const at = new Date(2026, 9, 6, 14, 32);

const rootConversation: ConversationSummary = {
	id: "1",
	title: "Workspace defaults",
	root: true,
	hidden: false,
	running: false,
	unread: false,
	tokens: 4200,
	cost: 0.0121,
};

const streamConversation: ConversationSummary = {
	id: "3",
	title: "The stream sends state views",
	root: false,
	hidden: false,
	running: false,
	unread: false,
	tokens: 12400,
	cost: 0.0432,
};

const conversations: ConversationSummary[] = [
	rootConversation,
	streamConversation,
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

const entries: TranscriptEntry[] = [
	{ kind: "user", id: "1", at, text: "Why did the worker restart?" },
	{
		kind: "assistant",
		id: "2",
		at,
		markdown: [
			"The supervisor saw the process exit and restarted it. The recovery path is",
			"idempotent, so the second death announcement was the bug.",
			"",
			"- the death was announced twice",
			"- the second announcement raced the first",
			"",
			"```go",
			"if !stopped {",
			"\trestart()",
			"}",
			"```",
		].join("\n"),
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
	{ kind: "notice", id: "4", at, text: "context compacted" },
];

/** A platform as the hook would return it, with literals instead of a gateway. */
function makePlatform(overrides: Partial<Platform> = {}): Platform {
	return {
		ready: true,
		conversations,
		deleted,
		entries,
		active: streamConversation,
		workerUp: true,
		connection: "live",
		clearFailure: noop,
		steerable: true,
		model: {
			value: "DeepSeek V4.1 Flash",
			origin: "workspace default",
			groups: [
				{
					label: "OpenCode Go",
					options: [
						{
							value: "opencode-go/deepseek",
							label: "DeepSeek V4.1 Flash",
							detail: "1000k",
						},
						{ value: "opencode-go/opus-5", label: "Opus 5", detail: "200k" },
					],
				},
			],
			onSelect: noop,
		},
		thinking: {
			value: "max",
			origin: "workspace default",
			groups: [
				{
					options: [
						{ value: "max", label: "max" },
						{ value: "medium", label: "medium" },
						{ value: "off", label: "off" },
					],
				},
			],
			onSelect: noop,
		},
		agent: {
			value: "scout",
			origin: "this conversation",
			groups: [
				{
					label: "workspace",
					options: [
						{
							value: "scout",
							label: "scout",
							description:
								"Reads the repository and reports, without editing anything.",
						},
						{
							value: "release-captain",
							label: "release-captain",
							description:
								"Cuts releases: checks the changelog and the version bumps, and refuses to tag a red build.",
						},
					],
				},
			],
			onSelect: noop,
		},
		commands: [
			{
				name: "deslop",
				description: "Simplify the work just completed, without changing behaviour",
				argumentHint: "[commit, range, or files]",
				source: "workspace",
			},
		],
		context: [],
		workspaces: [
			{
				name: "general",
				title: "acornfall",
				path: "/home/marcelo/workspace/acornfall",
				general: true,
				running: true,
				active: true,
			},
			{
				name: "demo",
				title: "Demo",
				path: "/tmp/ws-demo",
				general: false,
				running: false,
				active: false,
			},
		],
		selectWorkspace: noop,
		defaults: {
			model: "opencode-go/deepseek",
			thinking: "max",
			agent: "scout",
			modelOrigin: "install default",
			thinkingOrigin: "install default",
			agentOrigin: "last resort",
		},
		setDefault: noop,
		setWorkspace: noop,
		createWorkspace: noop,
		removeWorkspace: noop,
		sandbox: {
			engine: "microsandbox",
			version: "0.7.7",
			status: "Running",
			tools: true,
			isolated: true,
		},
		resolved: {
			name: "scout",
			source: "/acornfall/.agents/agents/scout.md",
			model: "opencode-go/deepseek",
			layers: [
				{ layer: "install", path: "~/.acornfall/agents/default.md" },
				{ layer: "workspace", path: "/acornfall/.agents/agents/scout.md" },
			],
		},
		harness: "pi-durable",
		inspectorOpen: [],
		setInspectorOpen: noop,
		setInspectorMaximized: noop,
		railOpen: false,
		railCollapsed: false,
		theme: "light",
		select: noop,
		rename: noop,
		hide: noop,
		fork: noop,
		send: () => Promise.resolve(),
		abort: noop,
		setRailWidth: noop,
		setRailOpen: noop,
		toggleRail: noop,
		toggleTheme: noop,
		...overrides,
	};
}

export const Default: Story = { args: { platform: makePlatform() } };

export const EmptyConversation: Story = {
	args: { platform: makePlatform({ entries: [], active: rootConversation }) },
};

/** A run is underway: stop, steer, or queue. */
export const Running: Story = {
	args: {
		platform: makePlatform({
			active: { ...streamConversation, running: true },
		}),
	},
};

/** A worker that cannot steer: the only busy choices are stop and queue. */
export const RunningWithoutSteering: Story = {
	args: {
		platform: makePlatform({
			active: { ...streamConversation, running: true },
			steerable: false,
		}),
	},
};

/** Nothing authenticated: the pickers are honest about having nothing to offer. */
export const NoProviders: Story = {
	args: {
		platform: makePlatform({
			model: { value: "", groups: [], disabled: true, onSelect: noop },
			thinking: { value: "", groups: [], disabled: true, onSelect: noop },
			agent: { value: "", groups: [], disabled: true, onSelect: noop },
		}),
	},
};

/** Below `lg` the rail is behind the toggle, and the composer's controls wrap. */
export const Phone: Story = {
	args: { platform: makePlatform() },
	parameters: { viewport: { defaultViewport: "phone" } },
};

export const PhoneRailOpen: Story = {
	args: { platform: makePlatform({ railOpen: true }) },
	parameters: { viewport: { defaultViewport: "phone" } },
};

/** The rail is a column that can be put away, and the choice survives a reload. */
export const RailCollapsed: Story = {
	args: { platform: makePlatform({ railCollapsed: true }) },
};

/** From 2xl the inspector is a pane of its own: the answer to "why did it see that". */
export const InspectorOpen: Story = {
	args: {
		platform: makePlatform({
			inspectorOpen: ["context"],
			context: foldContext([
				{
					id: 10,
					kind: "pi.system",
					model: [
						{
							content: "",
							sections: {
								preamble: "You are a careful engineer.",
								cwd: "<cwd>\n/acornfall\n</cwd>",
							},
							toolsAdded: [
								{
									name: "read",
									description: "read a file",
									parameters: { type: "object" },
								},
								{
									name: "bash",
									description: "run a command",
									parameters: { type: "object" },
								},
							],
						},
					],
				},
				{
					id: 92,
					kind: "pi.system",
					model: [
						{
							content: "",
							sections: { instructions: "global + workspace + agent" },
							toolsAdded: [
								{
									name: "edit",
									description: "edit a file",
									parameters: { type: "object" },
								},
							],
							toolsRemoved: [{ name: "bash" }],
						},
					],
				},
			]),
		}),
	},
	parameters: { viewport: { defaultViewport: "wide" } },
};
