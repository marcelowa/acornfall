import type { Meta, StoryObj } from "@storybook/react-vite";
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
