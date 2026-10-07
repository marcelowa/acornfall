import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	ContextMenu,
	ContextMenuCheckboxItem,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenuSeparator,
	ContextMenuShortcut,
	ContextMenuTrigger,
} from "./context-menu";

const meta = {
	title: "UI/ContextMenu",
	component: ContextMenu,
	parameters: { layout: "centered" },
} satisfies Meta<typeof ContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: {},
	render: () => (
		<ContextMenu>
			<ContextMenuTrigger className="flex h-32 w-72 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
				Right-click, or long-press on touch
			</ContextMenuTrigger>
			<ContextMenuContent className="w-56">
				<ContextMenuLabel>Conversation</ContextMenuLabel>
				<ContextMenuSeparator />
				<ContextMenuItem>
					Rename <ContextMenuShortcut>R</ContextMenuShortcut>
				</ContextMenuItem>
				<ContextMenuCheckboxItem checked>Keep in the rail</ContextMenuCheckboxItem>
				<ContextMenuSeparator />
				<ContextMenuItem variant="destructive">Delete</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	),
};
