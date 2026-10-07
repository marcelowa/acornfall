import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { Input } from "./input";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "./popover";

const meta = {
	title: "UI/Popover",
	component: Popover,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {},
	render: () => (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="outline">Workspace</Button>
			</PopoverTrigger>
			<PopoverContent className="w-72">
				<PopoverHeader>
					<PopoverTitle>Workspace</PopoverTitle>
					<PopoverDescription>~/workspace/acornfall</PopoverDescription>
				</PopoverHeader>
				<Input placeholder="Search" className="mt-3" />
			</PopoverContent>
		</Popover>
	),
};
