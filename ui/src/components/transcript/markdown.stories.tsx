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

/** A diagram is drawn from its fence, between the paragraphs that surround it. */
export const WithDiagram: Story = {
	render: () => (
		<div className="w-full max-w-2xl bg-background p-6">
			<Markdown>
				{[
					"How a reply is drawn:",
					"",
					"```mermaid",
					"graph TD",
					"  A[Reply] --> B{Fence?}",
					"  B -->|mermaid| C[Draw]",
					"  B -->|other| D[Code block]",
					"```",
					"",
					"And the prose after it is still prose.",
				].join("\n")}
			</Markdown>
		</div>
	),
};

/** A plan, drawn down its dots: the state of every step, including the one that is stuck. */
export const Steps: Story = {
	render: () => (
		<div className="w-full max-w-2xl bg-background p-6">
			<Markdown>
				{[
					"Where the release is:",
					"",
					"```steps",
					"done: the patch line is merged",
					"done: the worker runtime is pinned",
					"doing: the release notes",
					"blocked: the signing key is not on this machine",
					"todo: tag `v0.9.36` and push",
					"```",
				].join("\n")}
			</Markdown>
		</div>
	),
};

/** A chart is drawn from its fence, between the paragraphs that surround it. */
export const WithChart: Story = {
	render: () => (
		<div className="w-full max-w-2xl bg-background p-6">
			<Markdown>
				{[
					"What the suite found:",
					"",
					"```chart",
					"passed: 184",
					"failed: 6",
					"```",
					"",
					"And the prose after it is still prose.",
				].join("\n")}
			</Markdown>
		</div>
	),
};

/** The two forms a reply wears when the point is not the words: a marker a reader stops on, and a
 * plan a reader counts. `> [!KIND]` is GitHub's alert syntax; `- [x]` is GFM's task list. */
export const CalloutsAndChecklists: Story = {
	render: () => (
		<div className="w-full max-w-2xl bg-background p-6">
			<Markdown>
				{[
					"> [!NOTE]",
					"> A note is quiet: it tells you something is true.",
					"",
					"> [!TIP]",
					"> A tip is the way to do it sooner.",
					"",
					"> [!IMPORTANT]",
					"> An important line is one the reader cannot skip.",
					"",
					"> [!WARNING]",
					"> A warning is a risk: `make release` tags origin/main.",
					"",
					"> [!CAUTION]",
					"> A caution is what not to do.",
					"",
					"The plan, as a plan:",
					"",
					"- [x] write the callout",
					"- [x] tick what is done",
					"- [ ] count what is left",
				].join("\n")}
			</Markdown>
		</div>
	),
};
