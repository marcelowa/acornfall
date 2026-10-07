import type { Meta, StoryObj } from "@storybook/react-vite";
import type { VariantProps } from "class-variance-authority";
import { Badge, type badgeVariants } from "./badge";

const meta = {
	title: "UI/Badge",
	component: Badge,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

type Tone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;
const tones: Tone[] = ["neutral", "primary", "success", "warning", "info", "danger"];

export const Soft: Story = {
	args: { children: "Badge" },
	render: () => (
		<div className="flex flex-wrap items-center gap-3">
			{tones.map((tone) => (
				<Badge key={tone} tone={tone}>
					{tone}
				</Badge>
			))}
		</div>
	),
};

export const Solid: Story = {
	args: { children: "Badge" },
	render: () => (
		<div className="flex flex-wrap items-center gap-3">
			{tones.map((tone) => (
				<Badge key={tone} tone={tone} variant="solid">
					{tone}
				</Badge>
			))}
		</div>
	),
};

export const Outline: Story = {
	args: { children: "Badge" },
	render: () => (
		<div className="flex flex-wrap items-center gap-3">
			{tones.map((tone) => (
				<Badge key={tone} tone={tone} variant="outline">
					{tone}
				</Badge>
			))}
		</div>
	),
};

export const Sizes: Story = {
	args: { children: "Badge" },
	render: () => (
		<div className="flex items-center gap-3">
			<Badge size="sm">sm</Badge>
			<Badge>default</Badge>
			<Badge size="lg">lg</Badge>
		</div>
	),
};
