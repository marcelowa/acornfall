import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";
import { Button } from "./button";
import { Text } from "../typography/text";

const meta = {
	title: "UI/Card",
	component: Card,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

function Workspace() {
	return (
		<Card className="w-80">
			<CardHeader>
				<CardTitle>acornfall</CardTitle>
				<CardDescription>~/workspace/acornfall</CardDescription>
			</CardHeader>
			<CardContent>
				<Text size="sm" tone="muted">
					Three conversations, one sandbox, two agents.
				</Text>
			</CardContent>
			<CardFooter>
				<Button size="sm" variant="outline">
					Open
				</Button>
			</CardFooter>
		</Card>
	);
}

export const Outlined: Story = { args: {}, render: () => <Workspace /> };
export const Elevated: Story = {
	args: {},
	render: () => (
		<div className="bg-muted p-8">
			<Card variant="elevated" className="w-80">
				<CardHeader>
					<CardTitle>Elevated</CardTitle>
					<CardDescription>Raised off the page, no border.</CardDescription>
				</CardHeader>
			</Card>
		</div>
	),
};
export const Interactive: Story = {
	args: {},
	render: () => (
		<Card variant="interactive" className="w-80">
			<CardHeader>
				<CardTitle>Interactive</CardTitle>
				<CardDescription>Hover it: a card that is a link.</CardDescription>
			</CardHeader>
		</Card>
	),
};
