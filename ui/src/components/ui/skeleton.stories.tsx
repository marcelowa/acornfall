import type { Meta, StoryObj } from "@storybook/react-vite";
import { Skeleton } from "./skeleton";

const meta = {
	title: "UI/Skeleton",
	component: Skeleton,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Block: Story = {
	args: { className: "h-4 w-48" },
};

export const LoadingConversation: Story = {
	args: {},
	render: () => (
		<div className="flex w-80 flex-col gap-3">
			<Skeleton className="h-4 w-3/4" />
			<Skeleton className="h-4 w-full" />
			<Skeleton className="h-4 w-5/6" />
			<Skeleton className="mt-2 h-9 w-24 rounded-md" />
		</div>
	),
};
