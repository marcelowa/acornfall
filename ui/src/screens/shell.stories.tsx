import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/typography/text";
import { Shell } from "./shell";

const meta = {
	title: "Screens/Shell",
	component: Shell,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Shell>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Shell is the frame and nothing else: slots in, layout out. The composition that fills the
 * slots with real components is `Screens/Workspace`; this story is the contract, not the
 * product.
 */
const pane = (title: string, note: string) => (
	<Stack gap="sm" padding="lg" fill>
		<Text weight="semibold">{title}</Text>
		<Text size="sm" tone="muted">
			{note}
		</Text>
	</Stack>
);

export const Slots: Story = {
	args: {
		topbar: (
			<>
				<span className="flex shrink-0 items-center gap-2">
					<img
						src="/logo.svg"
						alt=""
						aria-hidden
						className="size-6 shrink-0 rounded-md"
					/>
					<Text as="span" size="sm" weight="semibold">
						Acornfall
					</Text>
				</span>
				<Text size="sm" className="truncate">
					conversation title
				</Text>
			</>
		),
		inspector: (
			<div className="border-l border-border bg-card p-2">
				<Text size="sm" weight="semibold">
					inspector
				</Text>
			</div>
		),
		rail: (
			<div className="h-full border-r border-border bg-card p-2">
				<Text size="sm" weight="semibold">
					rail
				</Text>
			</div>
		),
		transcript: pane("transcript", "A scroll region that owns its own height."),
		composer: (
			<div className="w-full border-t border-border">
				<Stack gap="sm" padding="md">
					<Text size="sm" tone="muted">
						composer
					</Text>
				</Stack>
			</div>
		),
	},
};
