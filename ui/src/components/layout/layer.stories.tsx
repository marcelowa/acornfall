import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { PanelLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Stack } from "./stack";
import { Text } from "@/components/typography/text";
import { Layer } from "./layer";

/**
 * The one layer: full width, slid in from the left, out to the left, and without a close of its
 * own — the bar's toggle is the X, which is why the layer starts below the bar and why it is not
 * modal. The rail and the workspaces list both arrive through it.
 */
const meta = {
	title: "Layout/Layer",
	component: Layer,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Layer>;

export default meta;
type Story = StoryObj<typeof meta>;

const aside = (
	<Stack gap="sm" padding="md" fill>
		<Text weight="semibold">The rail</Text>
		<Text size="sm" tone="muted">
			Conversations, the workspace head, and the foot. It brings no close of its own.
		</Text>
	</Stack>
);

const pane = (
	<Stack gap="sm" padding="lg" fill>
		<Text weight="semibold">The pane behind it</Text>
		<Text size="sm" tone="muted">
			Dimmed while the layer is open. Tapping it does not close the layer: the bar&rsquo;s
			toggle and Back do.
		</Text>
	</Stack>
);

function BelowBarFrame() {
	const [open, setOpen] = useState(true);
	return (
		<div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">
			<div className="flex h-[var(--bar-height)] shrink-0 items-center gap-2 border-b border-border px-1">
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label={open ? "Close navigation" : "Conversations"}
					aria-expanded={open}
					onClick={() => setOpen(!open)}
				>
					{open ? <X /> : <PanelLeft />}
				</Button>
				<Text size="sm" className="truncate">
					Conversation title
				</Text>
			</div>
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">{pane}</div>
			<Layer open={open} onOpenChange={setOpen} label="Conversations" belowBar>
				{aside}
			</Layer>
		</div>
	);
}

/** Below the bar: the bar stays mounted and its toggle is the only close. */
export const BelowTheBar: Story = {
	args: { open: true, onOpenChange: () => undefined, label: "Conversations", children: aside },
	render: () => <BelowBarFrame />,
	globals: { viewport: { value: "phone" } },
};

/** No bar: the layer takes the full height, which is what a screen with no bar gets. */
export const FullHeight: Story = {
	args: { open: true, onOpenChange: () => undefined, label: "Conversations", children: aside },
	render: () => (
		<div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground">
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">{pane}</div>
			<Layer open onOpenChange={() => undefined} label="Conversations">
				{aside}
			</Layer>
		</div>
	),
	globals: { viewport: { value: "phone" } },
};
