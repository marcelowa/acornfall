import type { Meta, StoryObj } from "@storybook/react-vite";
import type { VariantProps } from "class-variance-authority";
import { Button, type buttonVariants } from "./button";

const meta = {
	title: "UI/Button",
	component: Button,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

type Variant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
type Size = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

const variants: Variant[] = ["default", "secondary", "outline", "ghost", "destructive", "link"];
const sizes: Size[] = ["xs", "sm", "default", "lg"];

export const Default: Story = {
	args: { children: "Button" },
};

export const Variants: Story = {
	args: { children: "Button" },
	render: () => (
		<div className="flex flex-wrap items-center gap-3">
			{variants.map((variant) => (
				<Button key={variant} variant={variant}>
					{variant}
				</Button>
			))}
		</div>
	),
};

export const Sizes: Story = {
	args: { children: "Button" },
	render: () => (
		<div className="flex flex-wrap items-center gap-3">
			{sizes.map((size) => (
				<Button key={size} size={size}>
					{size}
				</Button>
			))}
		</div>
	),
};

export const Disabled: Story = {
	args: { children: "Disabled", disabled: true },
};
