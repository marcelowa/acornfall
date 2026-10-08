import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { Composer } from "./composer";
import { ChoiceControl } from "./choice-control";
import { SlashMenu } from "./slash-menu";

const meta = {
	title: "Conversation/Composer",
	component: Composer,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Composer>;

export default meta;
type Story = StoryObj<typeof meta>;

function Frame({
	children,
}: {
	children: (draft: [string, (value: string) => void]) => ReactNode;
}) {
	const [value, setValue] = useState("");
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

export const SlashKeyboard: Story = {
	args: { ...Idle.args, value: "/r" },
	render: () => <SlashKeyboardDemo />,
};
