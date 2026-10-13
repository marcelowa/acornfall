import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AuthFlow } from "@/app/auth-flow";
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
	answering: false,
	answered: false,
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

/**
 * The sign-in URL, with the paste the headless path needs: the console is often open on
 * another device, so the address is text to copy as much as a link to open.
 */
export const SignInUrl: Story = {
	args: {
		flow: {
			...flowBase,
			notices: [
				{
					kind: "auth_url",
					url: "https://openrouter.ai/auth?callback_url=http%3A%2F%2F127.0.0.1%3A45049%2Foauth%2Fcallback%2Fe480471b&code_challenge=d2Pb_D0PtvWDe_ajhsGwYhFr8DLoUidWT8UhYqorrAc",
					instructions:
						"Complete sign-in in your browser. If the browser is on another machine, paste the final redirect URL here.",
				},
			],
			prompt: {
				kind: "prompt",
				promptId: "p-2",
				promptType: "manual_code",
				message:
					"Complete sign-in in your browser, or paste the authorization code / redirect URL here:",
				placeholder: "http://127.0.0.1:45049/oauth/callback/e480471b",
			},
		},
		onPickMethod: noop,
		onAnswer: noop,
		onCancel: noop,
		onClose: noop,
	},
};

/** A device code and the address to enter it at, both copyable. */
export const DeviceFlow: Story = {
	args: {
		flow: {
			...flowBase,
			provider: { ...pending, id: "github-copilot", name: "GitHub Copilot" },
			notices: [
				{
					kind: "device_code",
					userCode: "ABCD-1234",
					verificationUri: "https://github.com/login/device",
				},
			],
			progress: "Waiting for approval…",
		},
		onPickMethod: noop,
		onAnswer: noop,
		onCancel: noop,
		onClose: noop,
	},
};

/**
 * The callback won the race: the provider resolved the prompt itself, so the field is gone and
 * the flow reads as finishing — which is what a reload or a slow exchange would have hidden.
 */
export const CallbackWon: Story = {
	args: {
		flow: {
			...flowBase,
			notices: [
				{
					kind: "auth_url",
					url: "https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a",
					instructions: "Complete login in your browser.",
				},
			],
			answered: true,
		},
		onPickMethod: noop,
		onAnswer: noop,
		onCancel: noop,
		onClose: noop,
	},
};

/** A choice the provider offers, as buttons that wrap the sentence they are. */
export const SelectPrompt: Story = {
	args: {
		flow: {
			...flowBase,
			prompt: {
				kind: "prompt",
				promptId: "p-3",
				promptType: "select",
				message: "Sign in to Radius:",
				options: [
					{ id: "browser", label: "Sign in with browser (recommended)" },
					{
						id: "device-code",
						label: "Sign in with device code (when signing in from another device)",
					},
				],
			},
		},
		onPickMethod: noop,
		onAnswer: noop,
		onCancel: noop,
		onClose: noop,
	},
};

/** An answer on its way: the field waits, so a second paste cannot race the first. */
export const Answering: Story = {
	args: {
		flow: {
			...flowBase,
			method: "api_key",
			answering: true,
			prompt: {
				kind: "prompt",
				promptId: "p-4",
				promptType: "secret",
				message: "Enter Anthropic API key",
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
