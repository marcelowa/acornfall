import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChevronsUpDown, PanelLeftClose, Plus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/typography/text";
import { Rail } from "./rail";

const meta = {
	title: "Layout/Rail",
	component: Rail,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="h-96 w-80 rounded-md border border-border bg-background">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof Rail>;

export default meta;
type Story = StoryObj<typeof meta>;

const brand = (
	<span className="flex items-center gap-2">
		<img src="/logo.svg" alt="" aria-hidden className="h-6 w-auto shrink-0" />
		<Text as="span" size="sm" weight="semibold">
			Acornfall
		</Text>
	</span>
);

const head = (
	<Text size="sm" weight="semibold" className="truncate">
		workspace
	</Text>
);

const headActions = (
	<>
		<Button type="button" variant="ghost" size="icon-xs" aria-label="Workspaces">
			<ChevronsUpDown />
		</Button>
		<Button type="button" variant="ghost" size="icon-xs" aria-label="Hide the rail">
			<PanelLeftClose />
		</Button>
	</>
);

const list = (
	<div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
		<Text size="sm" tone="muted" className="px-2">
			Rows go here.
		</Text>
	</div>
);

const foot = (
	<>
		<Button variant="ghost" size="sm" className="justify-start">
			<Plus />
			New conversation
		</Button>
		<Button variant="ghost" size="sm" className="justify-start">
			<Settings />
			Settings
		</Button>
	</>
);

/**
 * The three zones and nothing else: a title head with its icon buttons, a scrolling list,
 * a pinned foot of quiet sibling rows. The recessed surface and the padding are the
 * primitive's — the app passes slots, not classes.
 */
export const Zones: Story = { args: { brand, head, headActions, list, foot } };
