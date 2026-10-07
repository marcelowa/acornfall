import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ChoicePicker } from "@/app/view-models";
import { ChoiceControl } from "./choice-control";

const meta = {
	title: "Composer/Choice control",
	component: ChoiceControl,
	parameters: { layout: "centered" },
} satisfies Meta<typeof ChoiceControl>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

const agent: ChoicePicker = {
	value: "general",
	origin: "last resort",
	groups: [
		{
			label: "workspace",
			options: [
				{ value: "general", label: "general", description: "General assistant" },
				{
					value: "reviewer",
					label: "reviewer",
					description: "Reviews the repo against its own recorded decisions",
				},
			],
		},
	],
	onSelect: noop,
};

const model: ChoicePicker = {
	value: "deepseek-v4.1-flash",
	origin: "this conversation",
	groups: [
		{
			label: "opencode-go",
			options: [
				{ value: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", detail: "128k" },
				{ value: "minimax-m3", label: "MiniMax M3", detail: "192k" },
			],
		},
	],
	onSelect: noop,
};

const thinking: ChoicePicker = {
	value: "max",
	origin: "this conversation",
	groups: [
		{
			options: [
				{ value: "off", label: "off" },
				{ value: "medium", label: "medium" },
				{ value: "max", label: "max" },
			],
		},
	],
	onSelect: noop,
};

/** What runs the conversation, in one line: agent, model, thinking. */
export const Default: Story = {
	args: { agent, model, thinking },
};

/** The dialog behind it: the same three choices, each saying which layer its value came from. */
export const DialogOpen: Story = {
	args: { agent, model, thinking, defaultOpen: true },
};

/** Nothing authenticated: the control says so instead of offering a choice that would fail. */
export const NothingAvailable: Story = {
	args: {
		agent: { value: "", groups: [], disabled: true, onSelect: noop },
		model: { value: "", groups: [], disabled: true, onSelect: noop },
		thinking: { value: "", groups: [], disabled: true, onSelect: noop },
	},
};

/** A long model id and a level that was asked for and not offered: the line truncates rather
 * than pushing the chevron off the screen. */
export const LongValues: Story = {
	args: {
		agent: { ...agent, value: "release-captain-with-a-long-name" },
		model: {
			...model,
			value: "anthropic/claude-sonnet-6-with-a-very-long-suffix",
			origin: "install default",
		},
		thinking: { ...thinking, value: "medium", note: "max was asked for" },
	},
	globals: { viewport: { value: "phone" } },
};

/**
 * A pin that outlived its model. The conversation still says what it is pinned to — the point
 * is that it cannot run, and that the fix is one click away.
 */
export const StalePin: Story = {
	args: {
		agent,
		model: {
			...model,
			value: "deepseek-v4.2-flash",
			origin: "this conversation",
			note: "not available here",
			invalid: true,
		},
		thinking,
	},
};
