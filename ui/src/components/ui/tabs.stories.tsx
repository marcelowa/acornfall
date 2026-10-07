import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";
import { Text } from "../typography/text";

const meta = {
	title: "UI/Tabs",
	component: Tabs,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

function FormattedRaw({ variant }: { variant: "default" | "line" }) {
	return (
		<Tabs defaultValue="formatted" className="w-96">
			<TabsList variant={variant}>
				<TabsTrigger value="formatted">Formatted</TabsTrigger>
				<TabsTrigger value="raw">Raw</TabsTrigger>
			</TabsList>
			<TabsContent value="formatted">
				<Text size="sm" tone="muted">
					Markdown, rendered.
				</Text>
			</TabsContent>
			<TabsContent value="raw">
				<Text size="sm" tone="muted">
					The source the model wrote, exactly.
				</Text>
			</TabsContent>
		</Tabs>
	);
}

export const Default: Story = { args: {}, render: () => <FormattedRaw variant="default" /> };
export const Line: Story = { args: {}, render: () => <FormattedRaw variant="line" /> };
