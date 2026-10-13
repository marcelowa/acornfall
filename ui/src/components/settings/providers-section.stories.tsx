import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ProviderSummary } from "@/app/view-models";
import { ProvidersSection } from "./providers-section";

const meta = {
	title: "Screens/ProvidersSection",
	component: ProvidersSection,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-96 rounded-md border border-border bg-background p-4">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ProvidersSection>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

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
		id: "openai-codex",
		name: "OpenAI Codex (legacy)",
		authenticated: false,
		// Sign-in only: the row's own button says so, rather than a Connect that leads to
		// a dialog with one button in it.
		authTypes: ["oauth"],
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

export const Mixed: Story = {
	args: { providers, onConnect: noop, onDisconnect: noop, onRefresh: noop },
};

/** No key anywhere: the empty state says what to do. */
export const NoneConnected: Story = {
	args: {
		providers: providers.map((provider) => ({
			...provider,
			authenticated: false,
			source: undefined,
			authType: undefined,
			modelCount: 0,
		})),
		onConnect: noop,
		onDisconnect: noop,
		onRefresh: noop,
	},
};
