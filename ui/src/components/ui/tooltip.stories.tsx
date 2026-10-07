import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plus, Settings } from "lucide-react";
import { Button } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

const meta = {
	title: "UI/Tooltip",
	component: Tooltip,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {},
	render: () => (
		<div className="flex items-center gap-3">
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="outline" size="icon-sm" aria-label="New conversation">
						<Plus />
					</Button>
				</TooltipTrigger>
				<TooltipContent>New conversation</TooltipContent>
			</Tooltip>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant="outline" size="icon-sm" aria-label="Conversation settings">
						<Settings />
					</Button>
				</TooltipTrigger>
				<TooltipContent>Conversation settings</TooltipContent>
			</Tooltip>
		</div>
	),
};
