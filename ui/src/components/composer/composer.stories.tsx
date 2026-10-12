import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { Composer } from "./composer";
import { ChoiceControl } from "./choice-control";
import { SlashMenu } from "./slash-menu";
import { StatusPill } from "@/components/ui/status-pill";

const meta = {
	title: "Conversation/Composer",
	component: Composer,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Composer>;

export default meta;
type Story = StoryObj<typeof meta>;

function Frame({
	children,
	initial = "",
}: {
	children: (draft: [string, (value: string) => void]) => ReactNode;
	initial?: string | undefined;
}) {
	const [value, setValue] = useState(initial);
	return <div className="flex h-full flex-col justify-end">{children([value, setValue])}</div>;
}

const noop = (): void => undefined;

const models = [
	{
		label: "opencode-go",
		options: [
			{ value: "opencode-go/opus-5", label: "Opus 5", detail: "200k" },
			{ value: "opencode-go/sonnet-6", label: "Sonnet 6", detail: "200k" },
		],
	},
];

const controls = (
	<ChoiceControl
		agent={{
			value: "general",
			origin: "last resort",
			groups: [{ options: [{ value: "general", label: "general" }] }],
			onSelect: noop,
		}}
		model={{
			value: "Opus 5",
			origin: "workspace default",
			groups: models,
			onSelect: noop,
		}}
		thinking={{
			value: "medium",
			origin: "this conversation",
			groups: [{ options: [{ value: "medium", label: "medium" }] }],
			onSelect: noop,
		}}
	/>
);

export const Idle: Story = {
	args: {
		value: "",
		onChange: noop,
		onSend: noop,
		onAbort: noop,
		running: false,
		steerable: true,
		onSteer: noop,
		onQueue: noop,
		controls,
	},
	render: (args) => (
		<Frame>
			{([value, setValue]) => <Composer {...args} value={value} onChange={setValue} />}
		</Frame>
	),
};

/** A turn is running and the worker can be steered: stop, steer, or queue behind it. */
export const Running: Story = {
	args: {
		value: "wait, check the lock order first",
		onChange: noop,
		onSend: noop,
		onAbort: noop,
		running: true,
		steerable: true,
		onSteer: noop,
		onQueue: noop,
		controls,
	},
};

/** The worker cannot steer: the only busy choices are stop and queue. */
/** The worker cannot steer: Stop and Queue are the only landings. */
export const RunningWithoutSteering: Story = {
	args: {
		...Running.args,
		steerable: false,
	},
};

export const Disabled: Story = {
	args: {
		...Idle.args,
		disabled: true,
		placeholder: "Pick a conversation",
		value: "",
	},
};

export const WithSlashMenu: Story = {
	args: {
		...Idle.args,
		value: "/",
		above: (
			<SlashMenu
				commands={[
					{ name: "compact", description: "Compact the context now", source: "builtin" },
					{
						name: "review",
						description: "Review the current diff",
						source: "workspace",
						argumentHint: "[paths]",
					},
					{ name: "clear", description: "Start a fresh context", source: "builtin" },
				]}
				onSelect={noop}
			/>
		),
	},
};

const slashCommands = [
	{ name: "compact", description: "Compact the context now", source: "builtin" },
	{
		name: "review",
		description: "Review the current diff",
		source: "workspace",
		argumentHint: "[paths]",
	},
	{ name: "clear", description: "Start a fresh context", source: "builtin" },
];

/** The slash menu with its keyboard: arrows move, Enter picks, Escape dismisses. */
function SlashKeyboardDemo() {
	const [value, setValue] = useState("/r");
	const [index, setIndex] = useState(0);
	const word = /^\/(\S*)$/.exec(value)?.[1] ?? null;
	const matches =
		word === null ? [] : slashCommands.filter((command) => command.name.startsWith(word));
	const clamped = matches.length === 0 ? 0 : Math.min(index, matches.length - 1);
	return (
		<Frame>
			{([, setDraft]) => (
				<Composer
					value={value}
					onChange={(next) => {
						setValue(next);
						setDraft(next);
					}}
					onSend={noop}
					onAbort={noop}
					running={false}
					steerable
					onSteer={noop}
					onQueue={noop}
					controls={controls}
					above={
						matches.length === 0 ? undefined : (
							<SlashMenu
								commands={matches}
								highlighted={clamped}
								onHighlight={setIndex}
								onSelect={setValue}
							/>
						)
					}
					slashCount={matches.length}
					slashIndex={clamped}
					onSlashIndexChange={setIndex}
					onSlashPick={(pick) => {
						const match = matches[pick];
						if (match !== undefined) setValue(`/${match.name} `);
					}}
					onSlashDismiss={() => setValue("")}
				/>
			)}
		</Frame>
	);
}

/** Busy on a phone: the summary gets its own row and the actions sit right below it. */
export const RunningOnPhone: Story = {
	args: {
		...Running.args,
	},
	globals: { viewport: { value: "phone" } },
};

/**
 * The phone's rest state: one row that says what it is, the draft's own words, and every action.
 * It is what the composer is before a tap and after a send; tapping the row opens it and asks for
 * the keyboard. The open card on a phone carries the band above it — the pill plus the gap at
 * `composer-handle` — which is the drag that folds it again.
 */
export const Folded: Story = {
	args: { ...Idle.args, folded: true },
	globals: { viewport: { value: "phone" } },
	render: (args) => (
		<Frame>
			{([value, setValue]) => <Composer {...args} value={value} onChange={setValue} />}
		</Frame>
	),
};

/** Folded with a draft in it: the row still shows the words, so a fold never looks like a loss. */
export const FoldedWithDraft: Story = {
	args: { ...Folded.args, value: "Check the worker logs before the restart" },
	globals: { viewport: { value: "phone" } },
	render: (args) => (
		<Frame>
			{([value, setValue]) => <Composer {...args} value={value} onChange={setValue} />}
		</Frame>
	),
};

/**
 * Folded while something is wrong: the ambient pill stays in the folded row, and an upload in
 * flight says why the send is off. DELEGATOR's rule from step 04: a fold that hides a dropped
 * stream makes a dead run look alive.
 */
export const FoldedWithStatus: Story = {
	args: {
		...Folded.args,
		value: "",
		ambient: <StatusPill state="reconnecting" />,
		attachments: [{ key: "a-1", name: "logs.txt", size: 400, status: "uploading" }],
	},
	globals: { viewport: { value: "phone" } },
	render: (args) => (
		<Frame>
			{([value, setValue]) => <Composer {...args} value={value} onChange={setValue} />}
		</Frame>
	),
};

export const SlashKeyboard: Story = {
	args: { ...Idle.args, value: "/r" },
	render: () => <SlashKeyboardDemo />,
};

/** After a reply lands, the composer says what that reply cost in context. */
export const ContextUsage: Story = {
	args: {
		...Idle.args,
		contextUsed: 12480,
		contextWindow: 200000,
	},
	render: (args) => (
		<Frame>
			{([value, setValue]) => <Composer {...args} value={value} onChange={setValue} />}
		</Frame>
	),
};

/** Files riding the draft: one staged, one still uploading, one refused with its reason. */
export const WithAttachments: Story = {
	args: {
		...Idle.args,
		onAttachFiles: noop,
		onRemoveAttachment: noop,
		attachments: [
			{ key: "a-1", name: "shot.png", size: 12000, status: "ready" },
			{ key: "a-2", name: "notes.txt", size: 400, status: "uploading" },
			{
				key: "a-3",
				name: "dump.bin",
				size: 11 * 1024 * 1024,
				status: "failed",
				error: "one file carries 10 MB at most",
			},
		],
	},
	render: (args) => (
		<Frame>
			{([value, setValue]) => <Composer {...args} value={value} onChange={setValue} />}
		</Frame>
	),
};

/** Past 70% the line grows a Compact button that starts a manual compaction. */
export const ContextUsageFull: Story = {
	args: {
		...Idle.args,
		contextUsed: 160000,
		contextWindow: 200000,
		onCompact: noop,
	},
	render: (args) => (
		<Frame>
			{([value, setValue]) => <Composer {...args} value={value} onChange={setValue} />}
		</Frame>
	),
};

/** The window is unknown: the count stands alone, with no percent. */
export const ContextUsageWithoutWindow: Story = {
	args: {
		...Idle.args,
		contextUsed: 12480,
	},
	render: (args) => (
		<Frame>
			{([value, setValue]) => <Composer {...args} value={value} onChange={setValue} />}
		</Frame>
	),
};

/** A Hebrew draft starts from the right: the field follows the first strong character. */
export const RtlDraft: Story = {
	args: {
		...Idle.args,
	},
	render: (args) => (
		<Frame initial="שלום, תסביר לי את השינוי האחרון">
			{([value, setValue]) => <Composer {...args} value={value} onChange={setValue} />}
		</Frame>
	),
};
