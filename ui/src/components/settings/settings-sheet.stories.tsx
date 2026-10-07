import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@/components/layout/stack";
import { Picker } from "@/components/composer/picker";
import { Text } from "@/components/typography/text";
import { SettingsSheet } from "./settings-sheet";

const meta = {
	title: "Settings/SettingsSheet",
	component: SettingsSheet,
	parameters: { layout: "centered" },
} satisfies Meta<typeof SettingsSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

const seed = {
	workspace: {
		name: "general",
		title: "acornfall",
		path: "/home/marcelo/workspace/acornfall",
		general: true,
		running: true,
		active: true,
	},
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
			name: "sandboxed",
			title: "Pinned environment",
			path: "/home/marcelo/acornfall/workspaces/sandboxed",
			general: false,
			running: false,
			active: false,
			image: "ghcr.io/acornfall/sandbox:node-24",
			network: "off",
		},
	],
	defaults: (
		<Stack gap="sm">
			<Picker
				label="Model"
				value="DeepSeek V4.1 Flash"
				origin="install default"
				groups={[
					{
						label: "OpenCode Go",
						options: [
							{
								value: "opencode-go/deepseek",
								label: "DeepSeek V4.1 Flash",
								detail: "1000k",
							},
						],
					},
				]}
				onSelect={noop}
			/>
			<Picker
				label="Thinking"
				value="max"
				origin="install default"
				groups={[]}
				onSelect={noop}
			/>
			<Text size="2xs" tone="muted">
				The defaults are what a conversation inherits when it never chose.
			</Text>
		</Stack>
	),
};

/** The trigger lives in the composer; this is the sheet it opens. */
export const Open: Story = {
	args: {
		workspace: seed.workspace,
		workspaces: seed.workspaces,
		onUpdateWorkspace: noop,
		onCreateWorkspace: noop,
		onRemoveWorkspace: noop,
		defaults: seed.defaults,
		open: true,
		onOpenChange: noop,
	},
};

export const WithoutAnImage: Story = {
	args: {
		...Open.args,
		workspace: {
			...seed.workspace,
			image: undefined,
			network: "off",
		},
	},
};
