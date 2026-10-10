import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AuthFlow } from "@/app/use-platform";
import type { ProviderSummary } from "@/app/view-models";
import { ProviderLoginDialog } from "./provider-login-dialog";

const meta = {
	title: "Screens/ProviderLoginDialog",
	component: ProviderLoginDialog,
	parameters: { layout: "centered" },
} satisfies Meta<typeof ProviderLoginDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

const pending: ProviderSummary = {
	id: "opencode-go",
	name: "OpenCode Go",
	authenticated: false,
	authTypes: ["api_key", "oauth"],
	modelCount: 0,
};

const flowBase: AuthFlow = {
	authId: "auth-1",
	provider: pending,
	method: "oauth",
	notices: [],
	prompt: undefined,
	answering: false,
	outcome: undefined,
};

/** Before the flow starts: the method choice. */
export const PickMethod: Story = {
	args: { pending, onPickMethod: noop, onAnswer: noop, onCancel: noop, onClose: noop },
};

/** A key prompt waiting for an answer. */
export const KeyPrompt: Story = {
	args: {
		flow: {
			...flowBase,
			method: "api_key",
			prompt: {
				kind: "prompt",
				promptId: "p-1",
				promptType: "secret",
				message: "OpenCode API key",
				placeholder: "sk-…",
			},
		},
		onPickMethod: noop,
		onAnswer: noop,
		onCancel: noop,
		onClose: noop,
	},
};

/** Sign-in mid-flow: device code, progress, and a waiting prompt. */
export const DeviceFlow: Story = {
	args: {
		flow: {
			...flowBase,
			notices: [
				{
					kind: "auth_url",
					url: "https://example.com/activate",
					instructions: "Open the page, then come back.",
				},
				{
					kind: "device_code",
					userCode: "ABCD-1234",
					verificationUri: "https://example.com/activate",
				},
				{ kind: "progress", message: "Waiting for approval…" },
			],
		},
		onPickMethod: noop,
		onAnswer: noop,
		onCancel: noop,
		onClose: noop,
	},
};

/** A choice the provider offers, as buttons. */
export const SelectPrompt: Story = {
	args: {
		flow: {
			...flowBase,
			prompt: {
				kind: "prompt",
				promptId: "p-2",
				promptType: "select",
				message: "Which account?",
				options: [
					{ id: "a", label: "Personal", description: "Your own key" },
					{ id: "b", label: "Work" },
				],
			},
		},
		onPickMethod: noop,
		onAnswer: noop,
		onCancel: noop,
		onClose: noop,
	},
};

/** The key worked. */
export const Connected: Story = {
	args: {
		flow: { ...flowBase, outcome: { ok: true } },
		onPickMethod: noop,
		onAnswer: noop,
		onCancel: noop,
		onClose: noop,
	},
};

/** The key did not. */
export const Failed: Story = {
	args: {
		flow: { ...flowBase, outcome: { ok: false, message: "invalid API key" } },
		onPickMethod: noop,
		onAnswer: noop,
		onCancel: noop,
		onClose: noop,
		onRetry: noop,
	},
};
