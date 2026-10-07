import type { Meta, StoryObj } from "@storybook/react-vite";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./alert";

const meta = {
	title: "UI/Alert",
	component: Alert,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {
		className: "w-96",
		children: (
			<>
				<CircleCheck />
				<AlertTitle>Ready</AlertTitle>
				<AlertDescription>The sandbox is booted and waiting for a turn.</AlertDescription>
			</>
		),
	},
};

export const Destructive: Story = {
	args: {
		variant: "destructive",
		className: "w-96",
		children: (
			<>
				<TriangleAlert />
				<AlertTitle>The turn failed</AlertTitle>
				<AlertDescription>
					The provider refused the request. The conversation is intact.
				</AlertDescription>
			</>
		),
	},
};
