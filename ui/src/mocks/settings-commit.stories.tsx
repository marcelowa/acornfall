import type { Meta, StoryObj } from "@storybook/react-vite";
import { MockFrame } from "./frame";
import { MockImageField } from "./settings-commit";

const meta = {
	title: "Mocks/Settings — one commit moment",
	parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Today: Story = {
	render: () => (
		<MockFrame
			label="Today: the commit happens on blur and only the caption admits it"
			note="Panel finding (J5): the caption is the only thing carrying the exception, and a saved image reads the same as a typed one."
		>
			<MockImageField state="idle" moment="blur" />
		</MockFrame>
	),
};

export const Applied: Story = {
	render: () => (
		<MockFrame
			label="Applied, where the field sits"
			note="One commit moment per page: the field's own button, and the outcome on the field's own line. The caption no longer has to explain a difference between fields."
		>
			<MockImageField state="applied" moment="field" />
		</MockFrame>
	),
};

export const Refused: Story = {
	render: () => (
		<MockFrame
			label="Refused, where the field sits"
			note="The refusal stops living at the top of the pane while the field looks fine: the field itself carries the state, and the value that was refused is still there to correct."
		>
			<MockImageField state="refused" moment="field" />
		</MockFrame>
	),
};
