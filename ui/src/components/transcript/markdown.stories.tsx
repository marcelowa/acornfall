import type { Meta, StoryObj } from "@storybook/react-vite";
import { Markdown } from "./markdown";

const meta = {
	title: "Conversation/Markdown",
	parameters: {
		layout: "centered",
		docs: {
			description: {
				story: "Assistant text and tool output are untrusted. Raw HTML is escaped, images are refused, every link opens hardened, and the rendered HTML is sanitised before it reaches the DOM. The same assertions the old client's checks make run against this component when the app is wired.",
			},
		},
	},
	tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const source = [
	"# A reply renders",
	"",
	"Some **bold**, some *emphasis*, and some `inline code`.",
	"",
	"- one thing",
	"- another thing",
	"",
	"1. first",
	"2. second",
	"",
	"> Replies quote, because models quote.",
	"",
	"| tool | status |",
	"| ---- | ------ |",
	"| bash | done   |",
	"| edit | error  |",
	"",
	"```ts",
	'const reply = await conversation.ask("why?");',
	"```",
	"",
	"```",
	"no language: still a code block",
	"```",
	"",
	"A [link](https://example.com) opens hardened.",
	"",
	"Single newlines",
	"stay line breaks.",
	"",
	"<script>alert('not this')</script> is escaped, and ![an image](https://example.com/x.png) is refused.",
].join("\n");

export const Rendered: Story = {
	render: () => (
		<div className="w-full max-w-2xl bg-background p-6">
			<Markdown>{source}</Markdown>
		</div>
	),
};

export const Plain: Story = {
	render: () => (
		<div className="w-full max-w-2xl bg-background p-6">
			<Markdown>{"A single sentence with no markup at all."}</Markdown>
		</div>
	),
};

/** Right-to-left text reads right: the direction follows the first strong character. */
export const RightToLeft: Story = {
	render: () => (
		<div className="w-full max-w-2xl bg-background p-6">
			<Markdown>{"שלום, איך מריצים בדיקות?"}</Markdown>
		</div>
	),
};
