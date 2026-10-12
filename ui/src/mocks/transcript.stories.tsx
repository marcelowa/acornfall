import type { Meta, StoryObj } from "@storybook/react-vite";
import { MockFrame } from "./frame";
import {
	MockCommittedMessage,
	MockEnterChoice,
	MockThinkingCard,
	MockToolCardHeader,
} from "./transcript";

const meta = {
	title: "Mocks/Transcript — marks, Enter, tool card header",
	parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const at = new Date(Date.now() - 4 * 60_000);

export const CommittedSteer: Story = {
	render: () => (
		<MockFrame
			label="A steered message keeps its mark after it commits"
			note="Panel finding (J4, all three personas): the mark lives on the dashed pending card and disappears at commit. Proposed: the committed entry carries the same words in its footer, where the time already sits."
		>
			<div className="flex flex-col items-end gap-3">
				<MockCommittedMessage
					text="Use the token ramp, not a raw grey"
					at={at}
					action="steer"
				/>
				<MockCommittedMessage
					text="Then run the UI suite before you stop"
					at={at}
					action="followUp"
				/>
			</div>
		</MockFrame>
	),
};

export const EnterOptionHint: Story = {
	render: () => (
		<MockFrame
			label="Option A: keep Enter as steer, and say so"
			note="Enter sends as steer while a run is live today, silently. This option adds the line under the controls; the three buttons stay as they are, which is the shape all three personas preferred."
		>
			<MockEnterChoice option="hint" />
		</MockFrame>
	),
};

export const EnterOptionNewline: Story = {
	render: () => (
		<MockFrame
			label="Option B: Enter is a newline while a run is live"
			note="The docs already claim this. Steer stays the only way in mid-run, so the button is the affordance and the keyboard cannot send something the reader did not mean."
		>
			<MockEnterChoice option="newline" />
		</MockFrame>
	),
};

const output = [
	"$ git status --short",
	" M ui/src/components/conversation/conversation-row.tsx",
	" M ui/src/components/transcript/tool-card.tsx",
	"?? ui/src/mocks/",
	"",
	"$ bun test",
	" 58 pass, 0 fail",
];

export const ToolCardCollapsed: Story = {
	render: () => (
		<MockFrame
			label="Show output moves into the card header"
			note="Panel finding (J3, TINKERER): the control sits in the footer, under the output, so closing a 300-line card means scrolling past all of it. In the header it is reachable from the top of the card."
		>
			<MockToolCardHeader name="bash" lines={output} expanded={false} settled />
		</MockFrame>
	),
};

export const ToolCardStaysOpen: Story = {
	render: () => (
		<MockFrame
			label="Output that was open while the call ran stays open after it settles"
			note="Panel finding (J3, DELEGATOR): the live card is keyed live-<callId> and the settled one by the wire entry id, so React remounts the card and it collapses under the reader the moment the answer lands."
		>
			<MockToolCardHeader name="bash" lines={output} expanded settled />
		</MockFrame>
	),
};

const reasoning = [
	"The rail row already has a fixed dot column, so the second line does not need one.",
	"Spend belongs to the recognise step: it is how two similar conversations are told apart.",
	"The value is in state; the formatter is the only missing piece.",
	"A stopped run keeps its dot but loses the accent, and the line carries the time.",
].join("\n");

export const ThinkingCardHeader: Story = {
	render: () => (
		<MockFrame
			label="The thinking card gets the same header control as the tool card"
			note="Review note: reasoning and output are the same kind of long text, so they should fold the same way — the control in the header, not in the footer under the text."
		>
			<MockThinkingCard text={reasoning} expanded={false} settled />
		</MockFrame>
	),
};

export const ThinkingCardStaysOpen: Story = {
	render: () => (
		<MockFrame
			label="Reasoning that was open stays open after it settles"
			note="The live thinking entry is keyed live-thinking (app/map.ts:412) and the committed one by the wire entry id, so the card remounts and folds the reasoning the reader was following."
		>
			<MockThinkingCard text={reasoning} expanded settled />
		</MockFrame>
	),
};

/** A real turn is long: ten lines of a bash call is the common case, not the rare one. */
const shortOutput = [
	"$ git status --short",
	" M ui/src/components/conversation/conversation-row.tsx",
	" M ui/src/components/transcript/tool-card.tsx",
	"?? ui/src/mocks/",
	"",
	"$ bun test",
	" 77 pass",
	" 0 fail",
	" 148 expect() calls",
	"Ran 77 tests across 10 files. [1.57s]",
	"",
	"$ bun run check:system",
];

export const ToolCardPeek: Story = {
	render: () => (
		<MockFrame
			label="Folded: the first two lines, not a 200px window"
			note="Review note: the folded card should show what the call was doing and stop. The control in the header carries the count, so the size of what is hidden is never a guess. The window today is 200px of mono, which is most of a short output — nothing is actually being folded."
		>
			<MockToolCardHeader name="bash" lines={output} expanded={false} settled fold="peek" />
		</MockFrame>
	),
};

export const ThinkingCardPeek: Story = {
	render: () => (
		<MockFrame
			label="Folded reasoning: two lines"
			note="Reasoning is the longest text in a turn and the least often re-read, so it folds hardest: two lines, then the count on the control."
		>
			<MockThinkingCard text={reasoning} expanded={false} settled fold="peek" />
		</MockFrame>
	),
};

export const ToolCardShortOutputStaysOpen: Story = {
	render: () => (
		<MockFrame
			label="A twelve-line output has to stay open, or the peek hides an answer"
			note="The threshold is the pair to the peek: today a card folds past 10 lines or 2000 characters, so a twelve-line result would fold to two lines and need a click. Folded past about twenty lines, a two-line peek only ever folds things that were too long to read anyway."
		>
			<MockToolCardHeader name="bash" lines={shortOutput} expanded settled />
		</MockFrame>
	),
};
