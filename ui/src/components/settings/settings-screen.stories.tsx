import type { Meta, StoryObj } from "@storybook/react-vite";
import type { WorkspaceSummary } from "@/app/view-models";
import { Stack } from "@/components/layout/stack";
import { Picker } from "@/components/composer/picker";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SettingsScreen } from "./settings-screen";

const meta = {
	title: "Components/Settings screen",
	component: SettingsScreen,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SettingsScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

const workspace: WorkspaceSummary = {
	name: "general",
	title: "acornfall",
	path: "/home/marcelo/workspace/acornfall",
	general: true,
	running: true,
	active: true,
};

/**
 * The app builds the defaults section from the pickers it already has, so the story does the
 * same with literals: the screen does not know what a model is.
 */
const defaults = (
	<Stack gap="sm">
		<ToggleGroup
			type="single"
			defaultValue="workspace"
			variant="outline"
			size="sm"
			spacing={0}
			aria-label="Default scope"
		>
			<ToggleGroupItem value="workspace">This workspace</ToggleGroupItem>
			<ToggleGroupItem value="install">Every workspace</ToggleGroupItem>
		</ToggleGroup>
		<Picker
			label="Model"
			value="deepseek-v4.1-flash"
			origin="workspace default"
			groups={[
				{
					label: "opencode-go",
					options: [
						{ value: "deepseek-v4.1-flash", label: "deepseek-v4.1-flash" },
						{ value: "minimax-m3", label: "minimax-m3" },
					],
				},
			]}
			onSelect={noop}
		/>
		<Picker
			label="Thinking"
			value="max"
			origin="install default"
			groups={[
				{
					label: "levels",
					options: [
						{ value: "off", label: "off" },
						{ value: "medium", label: "medium" },
						{ value: "max", label: "max" },
					],
				},
			]}
			onSelect={noop}
		/>
		<Picker
			label="Agent"
			value="general"
			origin="last resort"
			groups={[
				{
					label: "agents",
					options: [
						{ value: "general", label: "general" },
						{ value: "researcher", label: "researcher" },
					],
				},
			]}
			onSelect={noop}
		/>
	</Stack>
);

export const Default: Story = {
	args: {
		theme: "system",
		onThemeChange: noop,
		workspace,
		onUpdateWorkspace: noop,
		defaults,
		onClose: noop,
	},
};

/** Dark is a token swap, not a second screen: the same settings with the other theme chosen. */
export const Dark: Story = {
	args: { ...Default.args, theme: "dark" },
};

/** A workspace that is not loaded yet: the form is there, and Save knows it has nothing. */
export const NoWorkspace: Story = {
	args: { ...Default.args, workspace: undefined },
};
