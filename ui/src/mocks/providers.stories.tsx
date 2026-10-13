import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AuthFlow } from "@/app/auth-flow";
import type { ProviderSummary } from "@/app/view-models";
import { ProviderLoginDialog } from "@/components/settings/provider-login-dialog";
import { Button } from "@/components/ui/button";
import { ClippedText } from "@/components/ui/clipped-text";
import { CopyButton } from "@/components/ui/copy-button";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/typography/text";
import { MockFrame } from "./frame";
import { AddressLabelled, ProviderListProposal } from "./providers";
import { providerRows } from "./providers-data";

/**
 * Step 06 mocks for run 3, the providers surface. Each story argues for one move, answers one
 * journey in `refactor-ux/run-3/03-journeys.md`, and is measured in `06-mocks.md`.
 *
 * The list stories are mock-only compositions (`providers.tsx`); the dialog stories render the
 * real dialog over real fixtures, because the long-address fix is mechanical and already in the
 * primitive — what the owner is looking at there is the product, at a length the sandbox ran.
 */
const meta = {
	title: "Mocks/Providers",
	// Fullscreen, not centered: a centered canvas sizes to its content, and a mock that argues
	// about long values must not be the thing that scrolls sideways on a phone.
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

/** A real OpenRouter authorization URL, captured from this sandbox's worker. */
const openRouterUrl =
	"https://openrouter.ai/auth?callback_url=http%3A%2F%2F127.0.0.1%3A38921%2Foauth%2Fcallback%2Fd980cf4b-63e6-43f8-b8a7-fff41f74c033&code_challenge=gfs5-jl7NapTmNtjgZCPdtFWJFGvhQG0nXl_rVGCHN4&code_challenge_method=S256";

const openrouter: ProviderSummary = {
	id: "openrouter",
	name: "OpenRouter",
	authenticated: false,
	authTypes: ["api_key", "oauth"],
	modelCount: 0,
};

const copilot: ProviderSummary = {
	id: "github-copilot",
	name: "GitHub Copilot",
	authenticated: false,
	authTypes: ["api_key", "oauth"],
	modelCount: 0,
};

/** The sign-in waiting on its address and the paste that races it. */
const signInFlow: AuthFlow = {
	authId: "auth-mock",
	provider: openrouter,
	method: "oauth",
	notices: [
		{
			kind: "auth_url",
			url: openRouterUrl,
			instructions:
				"Complete sign-in in your browser. If the browser is on another machine, paste the final redirect URL here.",
		},
	],
	prompt: {
		kind: "prompt",
		promptId: "p-mock",
		promptType: "manual_code",
		message:
			"Complete sign-in in your browser, or paste the authorization code / redirect URL here:",
		placeholder: "http://127.0.0.1:38921/oauth/callback/d980cf4b",
	},
	answering: false,
	answered: false,
	outcome: undefined,
};

/** A device code waiting for the person, with the address to enter it at. */
const deviceFlow: AuthFlow = {
	authId: "auth-mock",
	provider: copilot,
	method: "oauth",
	notices: [
		{
			kind: "device_code",
			userCode: "D164-672E",
			verificationUri: "https://github.com/login/device",
		},
	],
	progress: "Waiting for approval…",
	answering: false,
	answered: false,
	outcome: undefined,
};

/** A refusal in the provider's own words, as long as they get. */
const refusedFlow: AuthFlow = {
	authId: "auth-mock",
	provider: { ...openrouter, id: "openai-codex", name: "OpenAI Codex (legacy)" },
	method: "oauth",
	notices: [],
	answering: false,
	answered: false,
	outcome: {
		ok: false,
		message:
			'OpenAI Codex token exchange failed (401): { "error": { "message": "Could not validate your token. Please try signing in again.", "type": "invalid_request_error", "param": null, "code": "token_expired" } }',
	},
};

export const ListTheReading: Story = {
	render: () => (
		<MockFrame
			width="pane"
			label="The list answers 'what can this install use' before the scroll"
			note="J12, R1. Two named groups; Re-check beside the search, and it says what it read; the state line clips in mono and shows itself whole on hover, focus or tap; the search clears in one gesture. The panel's findings are in: the count is pluralised, the rows sort by the name they show, and 'claude' in the search now gets a hint instead of silence."
		>
			<ProviderListProposal rows={providerRows} />
		</MockFrame>
	),
};

export const ListADeadConnection: Story = {
	render: () => (
		<MockFrame
			width="pane"
			label="A dead connection is its own state, not 'Not connected'"
			note="J15, panel finding (DELEGATOR: 'a stopped provider is not representable here… I will find out via a failed run — the exact late discovery I came to avoid'). A stored credential whose check fails reads 'Not working · key stored' in the warning tone, leads with the connected rows, and offers Reconnect. Making it real needs one field from the worker (`stored` with `authenticated: false`); the mock shows the direction."
		>
			<ProviderListProposal rows={providerRows} broken={["anthropic"]} />
		</MockFrame>
	),
};

export const ListTheReadingPhone: Story = {
	globals: { viewport: { value: "phone" } },
	render: () => (
		<MockFrame
			width="phone"
			label="The same reading on a phone"
			note="J12, R5. The groups still answer first; the search, its clear and Re-check are three 44px targets in one row; the rows keep their action and the state line stays one line."
		>
			<ProviderListProposal rows={providerRows} />
		</MockFrame>
	),
};

export const AddressLabelledVariant: Story = {
	render: () => (
		<MockFrame
			width="dialog"
			label="The address as a label, or the address as text"
			note="J14, R1, R2 — the panel's question (TINKERER): it could read 63 of the address's 214 characters, and asked what printing the rest buys that Copy does not. Above: today's row, the whole address clipped. Below: the host as the label, with Copy carrying the whole of it either way."
		>
			<Stack gap="md">
				<span className="flex min-w-0 flex-wrap items-center gap-2">
					<ClippedText
						text={openRouterUrl}
						className="min-w-0 flex-1 font-mono text-2xs text-muted-foreground"
					/>
					<CopyButton value={openRouterUrl} label="Copy address" />
					<Button asChild variant="link" size="sm" className="shrink-0">
						<a href={openRouterUrl} target="_blank" rel="noreferrer">
							Open
						</a>
					</Button>
				</span>
				<AddressLabelled
					url={openRouterUrl}
					instructions="Complete sign-in in your browser. If the browser is on another machine, paste the final redirect URL here."
				/>
			</Stack>
		</MockFrame>
	),
};

export const AddressDesktop: Story = {
	render: () => (
		<>
			<MockFrame
				width="dialog"
				label="The address is one clipped line, Copy beside it, Open after it"
				note="J14, R1, R2 — the owner's named defect. The real dialog, a real 246-character OpenRouter address: the dialog stays 446px, the address clips at 250px and the whole of it is one hover, focus or tap away."
			>
				<Text size="2xs" tone="muted">
					The dialog below is the product, not a drawing.
				</Text>
			</MockFrame>
			<ProviderLoginDialog flow={signInFlow} onAnswer={noop} onCancel={noop} onClose={noop} />
		</>
	),
};

export const AddressPhone: Story = {
	globals: { viewport: { value: "phone" } },
	render: () => (
		<>
			<MockFrame
				width="phone"
				label="The same address on a phone"
				note="J14, R5. 342px of content: the address clips, Copy address and Open wrap under it, both at the 44px phone step. The paste field stays the whole time the callback could win."
			>
				<Text size="2xs" tone="muted">
					The dialog below is the product, not a drawing.
				</Text>
			</MockFrame>
			<ProviderLoginDialog flow={signInFlow} onAnswer={noop} onCancel={noop} onClose={noop} />
		</>
	),
};

export const DeviceCodePhone: Story = {
	globals: { viewport: { value: "phone" } },
	render: () => (
		<>
			<MockFrame
				width="phone"
				label="A device code and its address, both copyable"
				note="J14, R2. The code is the largest thing in the dialog; Copy code sits beside it, Copy address and Open under the address. Nothing to paste, nothing to hunt."
			>
				<Text size="2xs" tone="muted">
					The dialog below is the product, not a drawing.
				</Text>
			</MockFrame>
			<ProviderLoginDialog flow={deviceFlow} onAnswer={noop} onCancel={noop} onClose={noop} />
		</>
	),
};

export const RefusalLong: Story = {
	render: () => (
		<>
			<MockFrame
				width="dialog"
				label="A long refusal wraps, and the dialog still fits"
				note="J13, J15, R1, R3. The provider's own words, 214 characters with braces and quotes: they wrap inside the dialog and the dialog does not move. Try again is the next step, named."
			>
				<Text size="2xs" tone="muted">
					The dialog below is the product, not a drawing.
				</Text>
			</MockFrame>
			<ProviderLoginDialog
				flow={refusedFlow}
				onAnswer={noop}
				onCancel={noop}
				onClose={noop}
				onRetry={noop}
			/>
		</>
	),
};

export const TodayAgainstTheRule: Story = {
	render: () => (
		<Stack gap="md" className="w-full max-w-2xl">
			<Stack gap="2xs">
				<Text as="p" size="sm" weight="semibold">
					One long value used to widen the dialog; now it clips inside its line
				</Text>
				<Text as="p" size="2xs" tone="muted">
					The owner's defect, measured in this sandbox at a 1200×800 viewport before and
					after the primitive's fix: content 1465px in a 446px dialog, with the header and
					the footer stretched with it; after, 446px and 446px, and the address clips at
					250px with the whole of it one gesture away. Below, both boxes scroll sideways
					if their content is wider than they are — which is what the dialog did.
				</Text>
			</Stack>
			<div className="flex flex-col gap-4 md:flex-row">
				<div className="min-w-0 flex-1">
					<OldWideValue />
				</div>
				<div className="min-w-0 flex-1">
					<NewClippedValue />
				</div>
			</div>
		</Stack>
	),
};

/** The shape that widened the dialog: no `min-w-0` anywhere, so the grid column takes it all. */
function OldWideValue() {
	return (
		<Stack gap="2xs">
			<Text as="p" size="2xs" tone="muted">
				Before — the item keeps its content's width
			</Text>
			<div className="w-full overflow-x-auto rounded-lg border border-destructive/40 bg-card p-3">
				<p className="font-mono text-2xs">{openRouterUrl}</p>
			</div>
			<Text as="p" size="2xs" tone="muted">
				The bar under the box is the defect: the value decides the width, not the box.
			</Text>
		</Stack>
	);
}

/** The shipped shape: the item may shrink, and the value clips with the whole of it on demand. */
function NewClippedValue() {
	return (
		<Stack gap="2xs">
			<Text as="p" size="2xs" tone="muted">
				After — the item may shrink, the value clips
			</Text>
			<div className="w-full overflow-x-auto rounded-lg border border-border bg-card p-3">
				<div className="grid [&>*]:min-w-0">
					<ClippedText text={openRouterUrl} className="font-mono text-2xs" />
				</div>
			</div>
			<Text as="p" size="2xs" tone="muted">
				No bar: hover, focus or tap the address for the whole of it; Copy and Open sit
				beside it in the dialog.
			</Text>
		</Stack>
	);
}
