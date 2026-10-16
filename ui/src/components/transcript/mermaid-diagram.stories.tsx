import type { Meta, StoryObj } from "@storybook/react-vite";
import { MermaidDiagram } from "./mermaid-diagram";

/**
 * A fence the model wrote, drawn when the reply settles.
 *
 * Storybook is the only place a real drawing is visible: Mermaid needs layout, so the unit tests
 * cover the split and the guard and this covers the picture. A story that draws is also the fastest
 * way to see a theme change — flip the toolbar's theme and the diagram is re-drawn with it.
 */
const meta = {
	title: "Conversation/MermaidDiagram",
	parameters: {
		layout: "centered",
		docs: {
			description: {
				story: "Mermaid's own strict mode runs first, then a walk over the drawing removes what it leaves: an image, a handler, a `url()` that points outward. A diagram that cannot be drawn shows its source and one line saying why.",
			},
		},
	},
	tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const flowchart = [
	"graph TD",
	"  A[Ask] --> B{Diagram?}",
	"  B -->|yes| C[Draw]",
	"  B -->|no| D[Text]",
].join("\n");

const sequence = [
	"sequenceDiagram",
	"  participant U as You",
	"  participant C as Console",
	"  U->>C: send a turn",
	"  C-->>U: draw the reply",
].join("\n");

const broken = ["graph TD", "  A[Unclosed --> B{", "  --> |> |"].join("\n");

const hostile = [
	"graph TD",
	'  A["<img src=x onerror=alert(1)><script>alert(2)</script>"] --> B',
	'  click B "javascript:alert(3)"',
].join("\n");

/** The component in the context it lives in: inside a rendered reply, where the markdown styles
 * give the source block its surface. */
function Frame({ children }: { children: React.ReactNode }) {
	return <div className="markdown w-full max-w-2xl bg-background p-6">{children}</div>;
}

export const Flowchart: Story = {
	render: () => (
		<Frame>
			<MermaidDiagram source={flowchart} />
		</Frame>
	),
};

export const Sequence: Story = {
	render: () => (
		<Frame>
			<MermaidDiagram source={sequence} />
		</Frame>
	),
};

/** Mermaid's own words are the reason, in the pane, above the source that failed to draw. */
export const Broken: Story = {
	render: () => (
		<Frame>
			<MermaidDiagram source={broken} />
		</Frame>
	),
};

/** A label that tries to fetch and a link that tries to run: both are gone from the drawing. */
export const Hostile: Story = {
	render: () => (
		<Frame>
			<MermaidDiagram source={hostile} />
		</Frame>
	),
};

/** Past 8 kB the source is shown instead: Mermaid cannot cancel a render, so this is the guard. */
export const TooBig: Story = {
	render: () => (
		<Frame>
			<MermaidDiagram source={`graph TD\n${"  A --> B\n".repeat(1000)}`} />
		</Frame>
	),
};
