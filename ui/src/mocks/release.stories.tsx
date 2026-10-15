import type { Meta, StoryObj } from "@storybook/react-vite";
import type { UpdateStatus } from "@/app/client";
import { UpdateSection } from "@/components/settings/update-section";
import { Text } from "@/components/typography/text";
import { MockFrame } from "./frame";
import { Bar, BarMark, InstallSettingsPage, ReleasePage, RunsDialog } from "./release";
import { releaseCandidate, releases } from "./release-data";

/**
 * Step 06 mocks for run 4, the release surface. Each story argues for one move, answers a journey
 * in `refactor-ux/run-4/03-journeys.md`, and is measured in `06-mocks.md`. The data is this
 * repository's own releases — tags, dates, asset sizes, and the notes from the tag annotations,
 * because every GitHub release body is null (finding, `06-mocks.md`).
 */
const meta = {
	title: "Mocks/Release",
	// Fullscreen, not centered: a mock that argues about a full page must not be the thing
	// that scrolls sideways.
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const running = "v0.9.28";
const latest = releases[0];
const older = releases[5];
const noop = (): void => undefined;

/** The real card, as it is today, for contrast: one release, a `1` on the bar, notes behind a toggle. */
const todayStatus: UpdateStatus = {
	current: running,
	latest: latest?.tag ?? "",
	notes: latest?.notes ?? "",
	pinned: "",
	channel: "releases",
	autoCheck: true,
	checking: false,
	downloadSize: latest?.size ?? 0,
	workerSize: latest?.workerSize ?? 0,
	available: true,
	backups: ["2026-10-13-091500.000000000", "2026-10-12-201500.000000000"],
};

export const ThePageNewerRelease: Story = {
	render: () => (
		<MockFrame
			width="pane"
			label="The page: running → offered → changed → cost → the press"
			note={`J16, J17, J18. Running ${running}, target ${latest?.tag}. The state line first, then the release: its notes as prose, the notes of every release between as a list, the size and backup note as facts, the VM choice kept, Install last. The picker follows, with the running build marked.`}
		>
			<ReleasePage state="newer" running={running} target={latest!} />
		</MockFrame>
	),
};

export const ThePagePreReleases: Story = {
	render: () => (
		<MockFrame
			width="pane"
			label="Pre-release builds, one visit at a time"
			note={`J18. The switch widens the list and refetches it: ${releaseCandidate.tag} appears above the GAs, marked pre — monospace and muted, a fact, not a coloured alarm. The switch is off on every fresh open.`}
		>
			<ReleasePage
				state="newer"
				running={running}
				target={releaseCandidate}
				includePrerelease
			/>
		</MockFrame>
	),
};

export const ThePageUpToDate: Story = {
	render: () => (
		<MockFrame
			width="pane"
			label="Up to date, and still a place to pick a version"
			note={`J16, J21. Running ${latest?.tag}, the newest production release, checked 12 minutes ago. No card, no prompt, and the picker is still here: the page is a place, not a popup. The cut line says what the twenty hold.`}
		>
			<ReleasePage state="up-to-date" running={latest!.tag} target={latest!} />
		</MockFrame>
	),
};

export const ThePageVersionPicked: Story = {
	render: () => (
		<MockFrame
			width="pane"
			label="An older version, picked by hand"
			note={`J18. Running ${latest?.tag}, the page on ${older?.tag}: "older than the running build" in the facts line, the target's notes in prose, and the notes it would roll back over. Picking installs nothing and pins nothing.`}
		>
			<ReleasePage state="up-to-date" running={latest!.tag} target={older!} picked />
		</MockFrame>
	),
};

export const ThePageRestartPending: Story = {
	render: () => (
		<MockFrame
			width="pane"
			label="Restart pending: the state that needs you, on the page and in the bar"
			note={`J17, J19. The files are swapped, the old process answers, and Restart finishes it. The page carries it as a sentence with a control; the bar carries the same state, because the one thing that needs the owner cannot wait for a page visit.`}
		>
			<ReleasePage state="restart-pending" running={running} target={latest!} />
		</MockFrame>
	),
};

export const ThePageRolledBack: Story = {
	render: () => (
		<MockFrame
			width="pane"
			label="A failed update says what failed, and which tag"
			note={`J17, J19. The cause is the gateway's own sentence, the failed tag is named, the running build is stated, and both ways out — Check again, Roll back — are on the page.`}
		>
			<ReleasePage state="rolled-back" running={running} target={latest!} />
		</MockFrame>
	),
};

export const ThePageSourceRefused: Story = {
	render: () => (
		<MockFrame
			width="pane"
			label="The source did not answer, and the page says which refusal it is"
			note="J19. No token, no network, empty list: each is a sentence in the gateway's words, the last known release is still named, and Check now is one press. Never an empty picker."
		>
			<ReleasePage state="refused" running={running} target={latest!} />
		</MockFrame>
	),
};

export const ThePageDevBuild: Story = {
	render: () => (
		<MockFrame
			width="pane"
			label="A dev build says so, and claims nothing"
			note="J16, panel finding. A build with no release tag names itself, makes no newer or older claim, and keeps the bar clean. The picker still works: a release can be installed on purpose."
		>
			<ReleasePage state="dev" running="dev" target={latest!} />
		</MockFrame>
	),
};

export const TheBar: Story = {
	render: () => (
		<MockFrame
			width="pane"
			label="One mark, two widths, and the restart state in the same spot"
			note="J16, J20, R12. Desktop: the arrow with the newest GA's tag beside it, the tag in mono 2xs muted. Phone: the arrow alone, its accessible name carrying the target. Restart pending takes the same place, in the warning tone."
		>
			<div className="rounded-md border border-border">
				<Bar mark={<BarMark state="newer" tag={latest!.tag} />} />
				<div className="w-96 max-w-full">
					<Bar mark={<BarMark state="newer" tag={latest!.tag} phone />} />
				</div>
				<Bar mark={<BarMark state="restart-pending" />} />
			</div>
		</MockFrame>
	),
};

export const TheRunsDialog: Story = {
	render: () => (
		<MockFrame
			width="dialog"
			label="The runs gate is the gateway's, and stopping names what it stops"
			note="J17, panel finding. The gateway's own count — every started workspace, not the one in view — with the workspaces named, and three choices that each say what they do: Cancel, Not now (nothing queued), Stop runs and install."
		>
			<div className="rounded-lg border border-border p-3">
				<Text size="2xs" tone="muted">
					the dialog, open over the page
				</Text>
			</div>
			<RunsDialog count={5} workspaces="acornfall and hello-omri" />
		</MockFrame>
	),
};

export const ThePhone: Story = {
	render: () => (
		<MockFrame
			width="phone"
			label="The phone: one column, the mark alone, nothing sideways"
			note="J20. The same page at 390px: the state, the release, the notes, Install inside thumb reach, the picker's rows at 44px. The bar's mark is the arrow alone."
		>
			<div className="w-full">
				<Bar mark={<BarMark state="newer" tag={latest!.tag} phone />} />
				<ReleasePage state="newer" running={running} target={latest!} />
			</div>
		</MockFrame>
	),
	globals: { viewport: { value: "phone" } },
};

export const TheInstallSettingsPage: Story = {
	render: () => (
		<MockFrame
			width="pane"
			label="Settings' install side: the running build, auto-check, and the door"
			note="J21, panel finding. The Updates tab is gone: the running build and auto-check live here, and the Releases row is the permanent way in — the only in-app door when nothing newer is known. Check now lives on the page, with the releases."
		>
			<InstallSettingsPage running={running} />
		</MockFrame>
	),
};

export const TodayForContrast: Story = {
	render: () => (
		<MockFrame
			width="pane"
			label="Today, for contrast: one card, a 1 on the bar, the prefs in the same card"
			note="The product as it is on this branch. One release only, the notes behind a View notes toggle (and empty in real life, because the release bodies are null), the pin field, and auto-check in the same card. This is what the mock above replaces."
		>
			<UpdateSection
				status={todayStatus}
				runsActive={false}
				applying={false}
				onCheck={noop}
				onRefresh={noop}
				onApply={noop}
				onRollback={noop}
				onSavePrefs={noop}
				onLater={noop}
			/>
		</MockFrame>
	),
};
