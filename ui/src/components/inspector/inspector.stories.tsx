import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Text } from "@/components/typography/text";
import { Inspector, type InspectorSection } from "./inspector";

const meta = {
	title: "Inspector/Inspector",
	component: Inspector,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Inspector>;

export default meta;
type Story = StoryObj<typeof meta>;

const sections: InspectorSection[] = [
	{
		key: "context",
		title: "Context",
		hint: "7 sections · 5 tools",
		body: <Text size="sm">The prompt after every patch folded in.</Text>,
	},
	{
		key: "agent",
		title: "Agent",
		hint: "scout",
		body: <Text size="sm">Which layer contributed what.</Text>,
	},
	{
		key: "run",
		title: "Run",
		hint: "idle",
		body: <Text size="sm">Attempt, tools, queue.</Text>,
	},
];

function Frame({
	open: initialOpen,
	maximized: initialMaximized,
}: {
	open: string[];
	maximized?: string;
}) {
	const [open, setOpen] = useState(initialOpen);
	const [maximized, setMaximized] = useState<string | undefined>(initialMaximized);
	return (
		<div className="h-full w-96 border-l border-border bg-card">
			<Inspector
				sections={sections}
				open={open}
				onOpenChange={setOpen}
				maximized={maximized}
				onMaximizedChange={setMaximized}
			/>
		</div>
	);
}

/** Closed by default: the point is to open the one that explains the surprise. */
export const Closed: Story = {
	args: { sections, open: [], onOpenChange: () => undefined, onMaximizedChange: () => undefined },
	render: () => <Frame open={[]} />,
};

export const Open: Story = {
	args: {
		sections,
		open: ["context"],
		onOpenChange: () => undefined,
		onMaximizedChange: () => undefined,
	},
	render: () => <Frame open={["context"]} />,
};

/** One section takes the panel; the rest collapse to headers. */
export const Maximized: Story = {
	args: {
		sections,
		open: ["context"],
		maximized: "context",
		onOpenChange: () => undefined,
		onMaximizedChange: () => undefined,
	},
	render: () => <Frame open={["context"]} maximized="context" />,
};
