import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { Input } from "./input";
import { Button } from "./button";
import { Text } from "../typography/text";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "./dialog";

const meta = {
	title: "UI/Dialog",
	component: Dialog,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

function Definitions() {
	return (
		<>
			<DialogHeader>
				<DialogTitle>Agent definitions</DialogTitle>
				<DialogDescription>Which layer contributed what.</DialogDescription>
			</DialogHeader>
			<Text size="sm" tone="muted">
				Install defaults, then workspace resources, then this conversation overrides.
			</Text>
			<DialogFooter showCloseButton />
		</>
	);
}

export const Default: Story = {
	args: {},
	render: () => (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant="outline">Open dialog</Button>
			</DialogTrigger>
			<DialogContent>
				<Definitions />
			</DialogContent>
		</Dialog>
	),
};

export const Open: Story = {
	args: {},
	render: () => (
		<Dialog defaultOpen>
			<DialogContent>
				<Definitions />
			</DialogContent>
		</Dialog>
	),
};

/**
 * The same dialog with the phone's keyboard up: the inset is what `lib/keyboard.ts` writes from
 * the visual viewport, and the panel is centred on what can be seen — half the keyboard's height
 * up, and never taller than the room left above it. Every field in the app follows this, not just
 * the composer (owner, step 11).
 */
function KeyboardUpFrame() {
	useEffect(() => {
		document.documentElement.style.setProperty("--keyboard-inset", "300px");
		return () => {
			document.documentElement.style.removeProperty("--keyboard-inset");
		};
	}, []);
	return (
		<Dialog defaultOpen>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>New workspace name</DialogTitle>
					<DialogDescription>The field stays above the keyboard.</DialogDescription>
				</DialogHeader>
				<Input aria-label="Name" defaultValue="spikes" />
				<DialogFooter showCloseButton />
			</DialogContent>
		</Dialog>
	);
}

export const KeyboardUp: Story = {
	args: {},
	render: () => <KeyboardUpFrame />,
	globals: { viewport: { value: "phone" } },
};
