import type { Meta, StoryObj } from "@storybook/react-vite";
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
		reload: noop,
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
		subagent: false,
		screen: "conversation",
		showScreen: noop,
		newConversation: noop,
		composerFocusToken: 0,
		renameWorkspace: noop,
		defaults: {
			workspace: { model: "opencode-go/deepseek-v4.1-flash", thinking: "max", agent: "" },
			global: { model: "", thinking: "", agent: "scout" },
		},
		setDefault: noop,
		modelLabel: (value: string) => value.split("/").at(-1) ?? "",
		thinkingFor: () => [{ options: [{ value: "max", label: "max" }] }],
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
		railOpen: false,
		railCollapsed: false,
		theme: "light",
		themeChoice: "system",
		setThemeChoice: noop,
		select: noop,
		rename: noop,
		hide: noop,
		fork: noop,
		send: () => Promise.resolve(),
		abort: noop,
		setRailWidth: noop,
		setRailOpen: noop,
		toggleRail: noop,
		settingsTab: "workspace",
		showSettingsTab: noop,
		providers: [
			{
				id: "opencode-go",
				name: "OpenCode Go",
				authenticated: true,
				source: "OPENCODE_API_KEY",
				authType: "api_key",
				authTypes: ["api_key", "oauth"],
				modelCount: 29,
			},
		],
		startLogin: noop,
		answerLoginPrompt: noop,
		cancelLogin: noop,
		closeLogin: noop,
		logoutProvider: noop,
		refreshProviders: noop,
		update: undefined,
		refreshUpdate: noop,
		checkUpdateNow: noop,
		applyUpdateNow: noop,
		rollbackUpdateNow: noop,
		setUpdatePrefs: noop,
		...overrides,
	};
}

export const Default: Story = {
	args: { platform: makePlatform() },
	globals: { viewport: { value: "laptop" } },
};

export const EmptyConversation: Story = {
	args: { platform: makePlatform({ entries: [], active: rootConversation }) },
};

/** The transcript mid-run: the question asked, the answer arriving, the dots promising more. */
const runningEntries: TranscriptEntry[] = [
	...entries,
	{ kind: "user", id: "5", at, text: "Now check the lock order too" },
	{
		kind: "assistant",
		id: "6",
		at,
		markdown: "On it — reading the supervisor",
		live: true,
	},
];

/** A run is underway: the transcript shows it arriving, the footer offers stop, steer, queue. */
export const Running: Story = {
	args: {
		platform: makePlatform({
			entries: runningEntries,
			active: { ...streamConversation, running: true },
		}),
	},
};

/** A worker that cannot steer: the only busy choices are stop and queue. */
export const RunningWithoutSteering: Story = {
	args: {
		platform: makePlatform({
			entries: runningEntries,
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

/**
 * Below `lg` the rail is behind the toggle and the composer's controls wrap; the transcript
 * gets the whole screen. This is the layout, not a smaller desktop.
 */
export const Phone: Story = {
	args: { platform: makePlatform() },
	globals: { viewport: { value: "phone" } },
};

/** The same phone, with the rail open as a full-width drawer. */
export const PhoneRailOpen: Story = {
	args: { platform: makePlatform({ railOpen: true }) },
	globals: { viewport: { value: "phone" } },
};

/** The rail is a column that can be put away, and the choice survives a reload. */
export const RailCollapsed: Story = {
	args: { platform: makePlatform({ railCollapsed: true }) },
	globals: { viewport: { value: "laptop" } },
};

/** The stream dropped: the app keeps working from the last state it saw. */
export const Reconnecting: Story = {
	args: { platform: makePlatform({ connection: "reconnecting" }) },
	globals: { viewport: { value: "laptop" } },
};

/**
 * The harness is gone. The pill carries the reason and the composer is disabled, because
 * sending would fail and saying so is kinder than letting it try.
 */
export const HarnessDown: Story = {
	args: {
		platform: makePlatform({
			workerUp: false,
			workerError: "the harness process ended: signal: killed",
		}),
	},
	globals: { viewport: { value: "laptop" } },
};

/**
 * An action the server refused: the strip above the composer holds its own words — here, a
 * workspace name that is a path — until it is dismissed.
 */
export const RefusedAction: Story = {
	args: {
		platform: makePlatform({
			failure: 'a workspace name cannot contain a slash or a space: "ui-check/refused"',
		}),
	},
	globals: { viewport: { value: "laptop" } },
};

/** The workspace list, one screen over: open, rename, forget, or create. */
export const WorkspacesScreen: Story = {
	args: { platform: makePlatform({ screen: "workspaces" }) },
	globals: { viewport: { value: "laptop" } },
};

/** Settings, the other screen over: the theme, this workspace's sandbox, and its defaults. */
export const SettingsScreen: Story = {
	args: { platform: makePlatform({ screen: "settings", themeChoice: "dark", theme: "dark" }) },
	globals: { viewport: { value: "laptop" } },
};

/**
 * The same red in the product: this conversation was pinned to a model that the provider no
 * longer offers, so the line says so instead of quietly running something else.
 */
export const StalePin: Story = {
	args: {
		platform: makePlatform({
			model: {
				value: "deepseek-v4.2-flash",
				origin: "this conversation",
				note: "not available here",
				invalid: true,
				groups: [
					{
						label: "opencode-go",
						options: [
							{
								value: "opencode-go/deepseek-v4.1-flash",
								label: "DeepSeek V4.1 Flash",
							},
						],
					},
				],
				onSelect: noop,
			},
		}),
	},
	globals: { viewport: { value: "laptop" } },
};
