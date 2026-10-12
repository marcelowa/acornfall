import type { Meta, StoryObj } from "@storybook/react-vite";
import { MockFrame } from "./frame";
import { MockRailRow } from "./rail-row";

const meta = {
	title: "Mocks/Rail row — spend and last moved",
	parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const note =
	"Panel finding (J1, J6): spend and when it moved live in the title tooltip only, and a phone has no hover. Proposed: one second line, mono, 2xs, muted; a stopped run keeps its dot but loses the accent.";

export const Idle: Story = {
	render: () => (
		<MockFrame label="Idle rows: spend and when it moved, on the line" note={note} width="rail">
			<div className="flex flex-col rounded-md bg-rail p-1">
				<MockRailRow title="The stream sends state views" meta="12.4k tok · $0.0432 · 2h" />
				<MockRailRow title="Rail sorting by date" meta="3.1k tok · $0.0107 · 3d" />
			</div>
		</MockFrame>
	),
};

export const Active: Story = {
	render: () => (
		<MockFrame label="The active row keeps saying so three ways" note={note} width="rail">
			<div className="flex flex-col rounded-md bg-rail p-1">
				<MockRailRow
					title="The stream sends state views"
					meta="12.4k tok · $0.0432 · 2h"
					active
				/>
				<MockRailRow title="Rail sorting by date" meta="3.1k tok · $0.0107 · 3d" />
			</div>
		</MockFrame>
	),
};

export const RunningMoved: Story = {
	render: () => (
		<MockFrame label="A run that moved just now" note={note} width="rail">
			<div className="flex flex-col rounded-md bg-rail p-1">
				<MockRailRow
					title="Add the sandbox panel"
					meta="48.9k tok · $0.1902 · now"
					running
					active
				/>
			</div>
		</MockFrame>
	),
};

export const RunningStopped: Story = {
	render: () => (
		<MockFrame
			label="The same row after the run stopped moving"
			note="The dot stops asking to be watched: no accent, and the line carries when it last moved. Today the 30-minute server flag keeps the accent on a dead run and the row has no time at all."
			width="rail"
		>
			<div className="flex flex-col rounded-md bg-rail p-1">
				<MockRailRow
					title="Add the sandbox panel"
					meta="48.9k tok · $0.1902 · 38m"
					running
					stale
				/>
			</div>
		</MockFrame>
	),
};

export const Unread: Story = {
	render: () => (
		<MockFrame label="Unread keeps its own dot" note={note} width="rail">
			<div className="flex flex-col rounded-md bg-rail p-1">
				<MockRailRow title="A peer reported back" meta="1.2k tok · $0.0031 · 5m" unread />
			</div>
		</MockFrame>
	),
};

export const LongTitle: Story = {
	render: () => (
		<MockFrame
			label="A long title truncates, the second line stays whole"
			note="The title owns the first line; spend and time are 2xs, so a long title cannot push them out."
			width="rail"
		>
			<div className="flex flex-col rounded-md bg-rail p-1">
				<MockRailRow
					title="Rework the splitter so the inspector can dock at 2xl"
					meta="122.4k tok · $0.4821 · 1d"
				/>
			</div>
		</MockFrame>
	),
};

export const Phone: Story = {
	render: () => (
		<MockFrame
			label="The same row on a phone, in the drawer"
			note="The point of the finding: on a phone the values have to be on the row, because the tooltip has no equivalent. The drawer is full width, so the second line has room."
			width="phone"
		>
			<div className="flex flex-col rounded-md bg-rail p-1">
				<MockRailRow
					title="Add the sandbox panel"
					meta="48.9k tok · $0.1902 · 38m"
					running
					stale
				/>
				<MockRailRow title="Rail sorting by date" meta="3.1k tok · $0.0107 · 3d" unread />
			</div>
		</MockFrame>
	),
};
