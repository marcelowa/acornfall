import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/typography/text";
import { MockTypeColumn } from "./phone-type";

const meta = {
	title: "Mocks/Phone type — before and after",
	parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ladders: Story = {
	render: () => (
		<Stack gap="md" className="w-full max-w-3xl">
			<Stack gap="2xs">
				<Text as="p" size="sm" weight="semibold">
					The phone ladder has no step left between chrome and content
				</Text>
				<Text as="p" size="2xs" tone="muted">
					Panel finding (J6, TINKERER; verified in styles/globals.css:190-196): below
					640px 2xs/xs/sm shift up one step while base stays 14px, so a row title and the
					body are the same size. Left is what ships; right is the proposal from step 05.
				</Text>
			</Stack>
			<div className="grid gap-4 md:grid-cols-2">
				<MockTypeColumn variant="today" />
				<MockTypeColumn variant="proposed" />
			</div>
		</Stack>
	),
};
