import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ProviderSummary } from "@/app/view-models";
import { Stack } from "@/components/layout/stack";
import { Picker } from "@/components/composer/picker";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ProvidersSection } from "./providers-section";
import { SettingsScreen } from "./settings-screen";
import { InstallSection } from "@/components/release/install-section";

const meta = {
	title: "Screens/Settings",
	component: SettingsScreen,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SettingsScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

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

const install = (
	<InstallSection
		status={{
			current: "v0.9.33",
			latest: "v0.9.33",
			notes: "",
			channel: "releases",
			autoCheck: true,
			checking: false,
			available: false,
			backups: [],
			downloadSize: 13_600_000,
			workerSize: 81_000,
			runsActive: false,
			runs: [],
		}}
		onSavePrefs={noop}
		onOpenReleases={noop}
	/>
);

export const Default: Story = {
	args: {
		tab: "defaults",
		onTabChange: noop,
		theme: "system",
		onThemeChange: noop,
		defaults,
		providers: <ProvidersSection providers={providers} />,
		install,
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

/** A phone: the tab bar, the fields and the controls at 390px. */
export const Phone: Story = {
	args: Default.args,
	globals: { viewport: { value: "phone" } },
};

/** The install page: the running build, auto-check, and the door to the releases. */
export const Install: Story = {
	args: { ...Default.args, tab: "install" },
};
