import type { Meta, StoryObj } from "@storybook/react-vite";
import { Picker } from "./picker";

const meta = {
	title: "Composer/Picker",
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

/** The conversation chose this itself. */
export const Chosen: Story = {
	args: { label: "Model", value: "Opus 5", origin: "this conversation", groups, onSelect: noop },
};

/** The conversation never chose: the value and the layer that provided it. */
export const Inherited: Story = {
	args: {
		label: "Model",
		value: "Sonnet 6",
		origin: "workspace default",
		groups,
		onSelect: noop,
	},
};

export const NothingConfigured: Story = {
	args: { label: "Model", value: undefined, origin: undefined, groups: [], onSelect: noop },
};

export const Disabled: Story = {
	args: { label: "Agent", value: "scout", groups, onSelect: noop, disabled: true },
};
