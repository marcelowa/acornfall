import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronDown } from "lucide-react";
import { Button } from "./button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "./dropdown-menu";

const meta = {
	title: "UI/DropdownMenu",
	component: DropdownMenu,
	parameters: { layout: "centered" },
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {},
	render: () => (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline">
					provider/model <ChevronDown />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-56">
				<DropdownMenuLabel>This conversation</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem>
					opus/opus-5 <DropdownMenuShortcut>1</DropdownMenuShortcut>
				</DropdownMenuItem>
				<DropdownMenuItem>
					sonnet/sonnet-6 <DropdownMenuShortcut>2</DropdownMenuShortcut>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuCheckboxItem checked>Show thinking</DropdownMenuCheckboxItem>
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>Thinking level</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>
						<DropdownMenuRadioGroup value="medium">
							<DropdownMenuRadioItem value="low">Low</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="medium">Medium</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="high">High</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
				<DropdownMenuSeparator />
				<DropdownMenuItem variant="destructive">Tombstone conversation</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	),
};
