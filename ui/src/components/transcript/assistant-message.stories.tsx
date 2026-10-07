import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AssistantEntry } from "@/app/view-models";
import { AssistantMessage } from "./assistant-message";

const meta = {
	title: "Conversation/AssistantMessage",
	component: AssistantMessage,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-full max-w-2xl bg-background p-6">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof AssistantMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

const at = new Date(2026, 9, 6, 14, 32);

const entry: AssistantEntry = {
	kind: "assistant",
	id: "1",
	at,
	markdown: [
		"A reply with **markup**, a list, and a code block.",
		"",
		"- one",
		"- two",
		"",
		"```ts",
		'const reply = await conversation.ask("why?");',
		"```",
	].join("\n"),
};

export const Formatted: Story = { args: { entry } };

/** The same reply, toggled to the source the model actually wrote, per pane. */
export const Raw: Story = { args: { entry, defaultRaw: true } };

export const Failure: Story = {
	args: {
		entry: {
			kind: "assistant",
			id: "2",
			at,
			markdown: "",
			failure: "opencode-go/opus-5: the provider refused the request (429)",
		},
	},
};
