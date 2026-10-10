import type { Meta, StoryObj } from "@storybook/react-vite";
import { Picker } from "./picker";

const meta = {
	title: "Conversation/Picker",
	component: Picker,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Picker>;

export default meta;
type Story = StoryObj<typeof meta>;

const groups = [
	{
		label: "opencode-go",
		options: [
			{ value: "opencode-go/opus-5", label: "Opus 5", detail: "200k" },
			{ value: "opencode-go/sonnet-6", label: "Sonnet 6", detail: "200k" },
		],
	},
	{
		label: "local",
		options: [{ value: "local/llama", label: "Llama", detail: "local" }],
	},
];

const noop = (): void => undefined;

export const Chosen: Story = {
	args: { label: "Model", value: "Opus 5", groups, onSelect: noop },
};

/** A value that came from somewhere else is still shown as the value it is. */
export const Inherited: Story = {
	args: {
		label: "Model",
		value: "Sonnet 6",
		groups,
		onSelect: noop,
	},
};

export const NothingConfigured: Story = {
	args: { label: "Model", value: undefined, groups: [], onSelect: noop },
};

export const Disabled: Story = {
	args: { label: "Agent", value: "scout", groups, onSelect: noop, disabled: true },
};

/** Agents grouped by the layer that defined them, with the description a name cannot carry. */
export const Agents: Story = {
	args: {
		label: "Agent",
		value: "release-captain",
		groups: [
			{
				label: "workspace",
				options: [
					{
						value: "release-captain",
						label: "release-captain",
						description:
							"Cuts releases: checks the changelog and the version bumps, and refuses to tag a red build.",
					},
					{
						value: "scout",
						label: "scout",
						description: "Reads the repository and reports, without editing anything.",
					},
				],
			},
			{
				label: "install",
				options: [
					{
						value: "reviewer",
						label: "reviewer",
						description: "Reviews diffs for correctness and style.",
					},
				],
			},
		],
		onSelect: noop,
	},
};

/** A value that cannot run here any more: shown in red with the reason, not hidden. */
export const StaleValue: Story = {
	args: {
		label: "Model",
		value: "deepseek-v4.2-flash",
		note: "not available here",
		invalid: true,
		groups,
		onSelect: noop,
	},
};

/** More options than fit the eye: a filter narrows the list, the way the slash menu does. */
export const ManyOptions: Story = {
	args: {
		label: "Model",
		value: "Opus 5",
		groups: [
			{
				label: "opencode-go",
				options: [
					{ value: "opencode-go/opus-5", label: "Opus 5", detail: "200k" },
					{ value: "opencode-go/sonnet-6", label: "Sonnet 6", detail: "200k" },
					{ value: "opencode-go/haiku-5", label: "Haiku 5", detail: "200k" },
					{ value: "opencode-go/gpt-5", label: "GPT 5", detail: "400k" },
					{ value: "opencode-go/gpt-5-mini", label: "GPT 5 Mini", detail: "400k" },
					{ value: "opencode-go/gemini-3", label: "Gemini 3", detail: "1m" },
					{ value: "opencode-go/grok-4", label: "Grok 4", detail: "256k" },
					{ value: "opencode-go/deepseek-v4", label: "DeepSeek V4", detail: "128k" },
					{ value: "opencode-go/minimax-m3", label: "MiniMax M3", detail: "192k" },
					{ value: "opencode-go/llama-4", label: "Llama 4", detail: "local" },
				],
			},
		],
		onSelect: noop,
		defaultOpen: true,
	},
};
