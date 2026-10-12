import type { Meta, StoryObj } from "@storybook/react-vite";
import { ToolCard } from "./tool-card";

const meta = {
	title: "Conversation/ToolCard",
	component: ToolCard,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-full max-w-2xl bg-background p-6">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ToolCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const at = new Date(2026, 9, 6, 14, 32);

export const Done: Story = {
	args: {
		entry: {
			kind: "tool",
			id: "1",
			at,
			name: "bash",
			status: "done",
			isError: false,
			args: { command: "go test ./internal/workerpool" },
			output: "ok  \tgithub.com/acornfall/acornfall/gateway/internal/workerpool\t0.21s",
		},
	},
};

export const Error: Story = {
	args: {
		entry: {
			kind: "tool",
			id: "2",
			at,
			name: "edit",
			status: "done",
			isError: true,
			args: { path: "worker/src/main.ts" },
			output: "the file changed since it was read",
		},
	},
};

export const Running: Story = {
	args: {
		entry: {
			kind: "tool",
			id: "3",
			at,
			name: "bash",
			status: "running",
			isError: false,
			args: { command: "bun test" },
			output: "",
		},
	},
};

export const LongOutput: Story = {
	args: {
		entry: {
			kind: "tool",
			id: "5",
			at,
			name: "bash",
			status: "done",
			isError: false,
			args: { command: "go test ./..." },
			output: Array.from(
				{ length: 40 },
				(_, index) => `ok  \tpackage-${index}\t0.2${index}s`,
			).join("\n"),
		},
	},
};

/** The open form of a long card, with the way back to less. */
export const Expanded: Story = {
	args: {
		entry: {
			kind: "tool",
			id: "6",
			at,
			name: "bash",
			status: "done",
			isError: false,
			args: { command: "go test ./..." },
			output: Array.from(
				{ length: 40 },
				(_, index) => `ok  \tpackage-${index}\t0.2${index}s`,
			).join("\n"),
		},
		defaultExpanded: true,
	},
};

export const NoArguments: Story = {
	args: {
		entry: {
			kind: "tool",
			id: "4",
			at,
			name: "ls",
			status: "done",
			isError: false,
			output: "docs\nworker\nui",
		},
	},
};

/**
 * A folded card on a phone, with an MCP name long enough to push the control out of a card
 * header that cannot shrink. The name truncates and the control keeps its place; the fold button
 * is a size larger on a coarse pointer, because it is the only way back into the output.
 */
export const LongNameOnAPhone: Story = {
	args: {
		entry: {
			kind: "tool",
			id: "5",
			at,
			name: "mcp__playwright__browser_take_screenshot",
			status: "done",
			isError: false,
			args: { element: "the rail", path: "shot.png" },
			output: Array.from(
				{ length: 60 },
				(_, index) => `line ${index} of a long output that is folded to two lines`,
			).join("\n"),
		},
	},
	globals: { viewport: { value: "phone" } },
};
