import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import type { BusyAction } from "@/app/view-models";
import { Composer } from "./composer";
import { ChoiceControl } from "./choice-control";
import { SlashMenu } from "./slash-menu";

const meta = {
	title: "Composer/Composer",
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
		busyAction: "steer",
		onBusyActionChange: noop,
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
		busyAction: "steer",
		onBusyActionChange: noop,
		controls,
	},
};

/** The worker cannot steer: the only busy choices are stop and queue. */
export const RunningWithoutSteering: Story = {
	args: {
		...Running.args,
		steerable: false,
		busyAction: "followUp",
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

/** Steering chosen while a turn runs: the send button says how the message lands. */
export const SteerChosen: Story = {
	args: {
		...Running.args,
		busyAction: "steer" as BusyAction,
	},
};
