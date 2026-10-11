import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ProviderSummary, WorkspaceSummary } from "@/app/view-models";
import { Stack } from "@/components/layout/stack";
import { Picker } from "@/components/composer/picker";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ProvidersSection } from "./providers-section";
import { SettingsScreen } from "./settings-screen";
import { UpdateSection } from "./update-section";

const meta = {
	title: "Screens/Settings",
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

const providers: ProviderSummary[] = [
	{
		id: "opencode-go",
		name: "OpenCode Go",
		authenticated: true,
		source: "OPENCODE_API_KEY",
		authType: "api_key",
		authTypes: ["api_key", "oauth"],
		modelCount: 29,
	},
	{
		id: "commandcode",
		name: "CommandCode",
		authenticated: false,
		authTypes: ["api_key"],
		modelCount: 0,
	},
	{
		id: "aws",
		name: "AWS Bedrock",
		authenticated: false,
		authTypes: [],
		modelCount: 0,
	},
];

const updates = (
	<UpdateSection
		status={{
			current: "v0.8.0",
			latest: "v0.9.0",
			notes: "Faster sandbox boot.",
			pinned: "",
			channel: "releases",
			autoCheck: true,
			checking: false,
			available: true,
			backups: [],
			downloadSize: 13000000,
			workerSize: 70000,
		}}
		runsActive={false}
		applying={false}
		onCheck={noop}
		onRefresh={noop}
		onApply={noop}
		onRollback={noop}
		onSavePrefs={noop}
		onLater={noop}
	/>
);

export const Default: Story = {
	args: {
		tab: "workspace",
		onTabChange: noop,
		theme: "system",
		onThemeChange: noop,
		workspace,
		onUpdateWorkspace: noop,
		defaults,
		providers: <ProvidersSection providers={providers} />,
		updates,
		version: "v0.9.2",
		onClose: noop,
	},
};

/** Dark is a token swap, not a second screen: the same settings with the other theme chosen. */
export const Dark: Story = {
	args: { ...Default.args, theme: "dark" },
};

/** Each page has its own URL: the providers page. */
export const Providers: Story = {
	args: { ...Default.args, tab: "providers" },
};

/** The defaults page. */
export const Defaults: Story = {
	args: { ...Default.args, tab: "defaults" },
};

/** The appearance page. */
export const Appearance: Story = {
	args: { ...Default.args, tab: "appearance" },
};

/** The updates page: one release, one click. */
export const Updates: Story = {
	args: { ...Default.args, tab: "updates" },
};

const updatesApplying = (
	<UpdateSection
		status={{
			current: "v0.8.0",
			latest: "v0.9.0",
			notes: "Faster sandbox boot.",
			pinned: "",
			channel: "releases",
			autoCheck: true,
			checking: false,
			available: true,
			backups: [],
			downloadSize: 13000000,
			workerSize: 70000,
		}}
		runsActive={false}
		applying
		onCheck={noop}
		onRefresh={noop}
		onApply={noop}
		onRollback={noop}
		onSavePrefs={noop}
		onLater={noop}
	/>
);

/** Mid-apply: the button says so and stays pressed-disabled until the call settles. */
export const UpdatesApplying: Story = {
	args: { ...Default.args, tab: "updates", updates: updatesApplying },
};

/** A workspace that is not loaded yet: the form is there, and Save knows it has nothing. */
export const NoWorkspace: Story = {
	args: { ...Default.args, workspace: undefined },
};
