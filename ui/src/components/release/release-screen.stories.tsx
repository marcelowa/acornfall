import type { Meta, StoryObj } from "@storybook/react-vite";
import type { UpdateRelease, UpdateStatus } from "@/app/client";
import { Measure } from "@/components/layout/measure";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/typography/text";
import { ReleaseMark } from "./release-mark";
import { ReleaseScreen } from "./release-screen";
import { InstallSection } from "./install-section";

/**
 * The release surface, as it shipped (run 4 of the refactor-ux chain). The stories hand the page
 * fixtures through its own loader props, so every state the direction lists is reviewable
 * without a gateway: the page states, the picker with and without pre-releases, a picked version,
 * the bar's mark at both widths, and the install-wide settings section.
 */
const meta = {
	title: "Screens/Release",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

const mb = 1_000_000;
const kb = 1_000;

/** The relation the gateway would answer, so a fixture cannot claim one the real read would not. */
function relationOf(current: string, tag: string): UpdateRelease["relation"] {
	if (tag === current) return "running";
	const parts = (value: string): number[] =>
		value.replace(/^v/, "").split("-")[0]!.split(".").map(Number);
	const [a, b] = [parts(tag), parts(current)];
	for (let index = 0; index < 3; index++) {
		if ((a[index] ?? 0) !== (b[index] ?? 0))
			return (a[index] ?? 0) > (b[index] ?? 0) ? "newer" : "older";
	}
	return tag.includes("-") ? "older" : "newer";
}

function release(
	tag: string,
	date: string,
	notes: string,
	current: string,
	prerelease = false,
): UpdateRelease {
	return {
		tag,
		name: tag,
		notes,
		publishedAt: `${date}T12:00:00Z`,
		prerelease,
		downloadSize: 13.6 * mb,
		workerSize: 81 * kb,
		relation: relationOf(current, tag),
	};
}

const listFor = (current: string): UpdateRelease[] => [
	release(
		"v0.9.33",
		"2026-10-13",
		"Provider sign-in: a long address cannot widen the dialog.",
		current,
	),
	release("v0.9.32", "2026-10-13", "Provider sign-in: a prompt cannot be lost.", current),
	release(
		"v0.9.31",
		"2026-10-13",
		"The rail is a stack: the workspaces list fills the sidebar.",
		current,
	),
	release("v0.9.30", "2026-10-13", "Two small fixes on top of the phone pass.", current),
	release("v0.9.29", "2026-10-12", "The phone pass: one layer with one close.", current),
	release(
		"v0.9.28",
		"2026-10-12",
		"The refactor-ux pass: the rail row carries spend and when it moved.",
		current,
	),
	release("v0.9.27", "2026-10-12", "", current),
	release(
		"v0.9.26",
		"2026-10-11",
		"Amber brand system: bronze primary, blue secondary.",
		current,
	),
	release(
		"v0.9.25",
		"2026-10-11",
		"Favicon follows the new brand mark: one logo everywhere.",
		current,
	),
	release("v0.9.24", "2026-10-11", "New brand mark: the long acornfall logo.", current),
];

const candidateFor = (current: string): UpdateRelease =>
	release(
		"v0.9.34-rc.1",
		"2026-10-15",
		"Release candidate for the release surface.",
		current,
		true,
	);

function status(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
	return {
		current: "v0.9.28",
		latest: "v0.9.33",
		notes: "",
		channel: "releases",
		autoCheck: true,
		checking: false,
		downloadSize: 13.6 * mb,
		workerSize: 81 * kb,
		available: true,
		backups: [],
		runsActive: false,
		runs: [],
		...overrides,
	};
}

/** The reads the page owns, as the gateway would answer them for one running build. */
function fixtureFor(current: string): {
	loadReleases: (prereleases: boolean) => Promise<UpdateRelease[]>;
	loadRelease: (tag: string) => Promise<UpdateRelease>;
} {
	const list = listFor(current);
	return {
		loadReleases: async (prereleases: boolean) =>
			prereleases ? [candidateFor(current), ...list] : list,
		loadRelease: async (tag: string) =>
			tag === candidateFor(current).tag
				? candidateFor(current)
				: (list.find((item) => item.tag === tag) ?? list[0]!),
	};
}

function Frame({
	label,
	note,
	children,
}: {
	label: string;
	note: string;
	children: React.ReactNode;
}) {
	return (
		<Measure size="page" padding="lg">
			<Stack gap="sm">
				<Stack gap="2xs">
					<Text as="p" size="sm" weight="semibold">
						{label}
					</Text>
					<Text as="p" size="2xs" tone="muted">
						{note}
					</Text>
				</Stack>
				<div className="rounded-lg border border-border">{children}</div>
			</Stack>
		</Measure>
	);
}

export const NewerRelease: Story = {
	render: () => (
		<Frame
			label="Running → offered → changed → cost → Install"
			note="J16, J17, J18. The state line, the target with its notes and the notes in between, the facts, the VM choice, Install last, and the picker below with the running build marked."
		>
			<ReleaseScreen
				status={status()}
				tag=""
				applying={false}
				onOpenTag={noop}
				onClose={noop}
				onCheck={noop}
				onRefresh={noop}
				onApply={noop}
				onRestart={noop}
				onRollback={noop}
				{...fixtureFor("v0.9.28")}
			/>
		</Frame>
	),
};

export const PreReleaseBuild: Story = {
	render: () => (
		<Frame
			label="Pre-release builds, one visit at a time"
			note="J18. The switch widens and refetches: v0.9.34-rc.1 above the GAs, marked pre in muted mono — a fact, not a coloured alarm. The switch is off on every fresh open."
		>
			<ReleaseScreen
				status={status()}
				tag="v0.9.34-rc.1"
				applying={false}
				onOpenTag={noop}
				onClose={noop}
				onCheck={noop}
				onRefresh={noop}
				onApply={noop}
				onRestart={noop}
				onRollback={noop}
				{...fixtureFor("v0.9.28")}
			/>
		</Frame>
	),
};

export const VersionPicked: Story = {
	render: () => (
		<Frame
			label="An older version, picked by hand"
			note="J18. The target says 'older than the running build' in its facts line, with its own notes; picking installs nothing and pins nothing."
		>
			<ReleaseScreen
				status={status()}
				tag="v0.9.24"
				applying={false}
				onOpenTag={noop}
				onClose={noop}
				onCheck={noop}
				onRefresh={noop}
				onApply={noop}
				onRestart={noop}
				onRollback={noop}
				{...fixtureFor("v0.9.28")}
			/>
		</Frame>
	),
};

export const UpToDate: Story = {
	render: () => (
		<Frame
			label="Up to date, and still a place to pick a version"
			note="J16, J21. No prompt, and the picker is still here: the page is a place, not a popup."
		>
			<ReleaseScreen
				status={status({ current: "v0.9.33", latest: "v0.9.33", available: false })}
				tag=""
				applying={false}
				onOpenTag={noop}
				onClose={noop}
				onCheck={noop}
				onRefresh={noop}
				onApply={noop}
				onRestart={noop}
				onRollback={noop}
				{...fixtureFor("v0.9.33")}
			/>
		</Frame>
	),
};

export const RestartPending: Story = {
	render: () => (
		<Frame
			label="Restart pending, with the control that finishes it"
			note="J17, J19. The files are swapped and the old process answers; Restart replaces it with the binary on disk, and the page follows until the gateway says otherwise (R11)."
		>
			<ReleaseScreen
				status={status({ restartRequired: true })}
				tag=""
				applying={false}
				onOpenTag={noop}
				onClose={noop}
				onCheck={noop}
				onRefresh={noop}
				onApply={noop}
				onRestart={noop}
				onRollback={noop}
				{...fixtureFor("v0.9.28")}
			/>
		</Frame>
	),
};

export const Installing: Story = {
	render: () => (
		<Frame
			label="Installing: every step named, and the tag with it"
			note="J17, R10. Backup, download, verify, then runs stop and the build swaps. The button says Installing and the page follows."
		>
			<ReleaseScreen
				status={status()}
				tag=""
				applying
				onOpenTag={noop}
				onClose={noop}
				onCheck={noop}
				onRefresh={noop}
				onApply={noop}
				onRestart={noop}
				onRollback={noop}
				{...fixtureFor("v0.9.28")}
			/>
		</Frame>
	),
};

export const RolledBack: Story = {
	render: () => (
		<Frame
			label="A failed update says what failed, and which tag"
			note="J17, J19. The gateway's cause, both ways out, and the running build named."
		>
			<ReleaseScreen
				status={status({
					failed: "migrate failed, rolled back: migrate v0.9.33: exit 1: cannot open state/state.db",
				})}
				tag=""
				applying={false}
				onOpenTag={noop}
				onClose={noop}
				onCheck={noop}
				onRefresh={noop}
				onApply={noop}
				onRestart={noop}
				onRollback={noop}
				{...fixtureFor("v0.9.28")}
			/>
		</Frame>
	),
};

export const SourceRefused: Story = {
	render: () => (
		<Frame
			label="The source did not answer, and the page says which refusal"
			note="J19. The list's refusal in the gateway's words; the state line still names the running build and the newest known release."
		>
			<ReleaseScreen
				status={status()}
				tag=""
				applying={false}
				onOpenTag={noop}
				onClose={noop}
				onCheck={noop}
				onRefresh={noop}
				onApply={noop}
				onRestart={noop}
				onRollback={noop}
				loadReleases={async () => {
					throw new Error(
						"releases: github answered 404 Not Found — a private repo needs ACORNFALL_GITHUB_TOKEN",
					);
				}}
				loadRelease={fixtureFor("v0.9.28").loadRelease}
			/>
		</Frame>
	),
};

export const DevBuild: Story = {
	render: () => (
		<Frame
			label="A dev build says so, and claims nothing"
			note="J16. No release tag, no newer or older claims, an arrow-free bar — and the picker still works: a release can be installed on purpose."
		>
			<ReleaseScreen
				status={status({ current: "dev", available: false })}
				tag=""
				applying={false}
				onOpenTag={noop}
				onClose={noop}
				onCheck={noop}
				onRefresh={noop}
				onApply={noop}
				onRestart={noop}
				onRollback={noop}
				{...fixtureFor("v0.9.28")}
			/>
		</Frame>
	),
};

export const NoSuchRelease: Story = {
	render: () => (
		<Frame
			label="A link to a release the source does not have"
			note="J18. The by-name read answers 404, and the page says so instead of showing an empty release."
		>
			<ReleaseScreen
				status={status()}
				tag="v9.9.9"
				applying={false}
				onOpenTag={noop}
				onClose={noop}
				onCheck={noop}
				onRefresh={noop}
				onApply={noop}
				onRestart={noop}
				onRollback={noop}
				loadReleases={fixtureFor("v0.9.28").loadReleases}
				loadRelease={async () => {
					throw new Error("releases: no release v9.9.9 (404 Not Found)");
				}}
			/>
		</Frame>
	),
};

export const ThePhone: Story = {
	render: () => (
		<Frame
			label="The phone: one column, nothing sideways, the mark alone"
			note="J20, R9. The same page at 390px, and the bar's mark without its tag."
		>
			<div className="flex flex-col">
				<div className="flex h-14 items-center gap-2 border-b border-border px-3">
					<Text as="span" size="sm" weight="semibold">
						acornfall
					</Text>
					<div className="min-w-0 flex-1" />
					<ReleaseMark status={status()} onOpen={noop} />
				</div>
				<ReleaseScreen
					status={status()}
					tag=""
					applying={false}
					onOpenTag={noop}
					onClose={noop}
					onCheck={noop}
					onRefresh={noop}
					onApply={noop}
					onRestart={noop}
					onRollback={noop}
					{...fixtureFor("v0.9.28")}
				/>
			</div>
		</Frame>
	),
	globals: { viewport: { value: "phone" } },
};

export const TheMark: Story = {
	render: () => (
		<Measure size="page" padding="lg">
			<Stack gap="md">
				<Stack gap="2xs">
					<Text as="p" size="sm" weight="semibold">
						One mark, two widths
					</Text>
					<Text as="p" size="2xs" tone="muted">
						J16, R12. The tag beside the arrow where there is room, the arrow alone on a
						phone with the target in its accessible name, and restart pending in the
						same spot in the warning tone.
					</Text>
				</Stack>
				<div className="flex flex-col gap-2 rounded-lg border border-border">
					<div className="flex h-14 items-center gap-2 border-b border-border px-3">
						<Text as="span" size="sm" weight="semibold">
							acornfall
						</Text>
						<div className="min-w-0 flex-1" />
						<ReleaseMark status={status()} onOpen={noop} />
					</div>
					<div className="flex h-14 items-center gap-2 border-b border-border px-3">
						<Text as="span" size="sm" weight="semibold">
							acornfall
						</Text>
						<div className="min-w-0 flex-1" />
						<ReleaseMark status={status({ restartRequired: true })} onOpen={noop} />
					</div>
					<div className="flex h-14 items-center gap-2 px-3">
						<Text as="span" size="sm" weight="semibold">
							acornfall
						</Text>
						<div className="min-w-0 flex-1" />
						<ReleaseMark status={status({ available: false })} onOpen={noop} />
						<Text as="span" size="2xs" tone="muted">
							up to date: no mark at all
						</Text>
					</div>
				</div>
			</Stack>
		</Measure>
	),
};

export const InstallSettingsPage: Story = {
	render: () => (
		<Measure size="page" padding="lg">
			<Stack gap="lg">
				<Stack gap="2xs">
					<Text as="p" size="sm" weight="semibold">
						Settings' install-wide page
					</Text>
					<Text as="p" size="2xs" tone="muted">
						J21. The running build and auto-check live here, and the Releases row is the
						permanent door — the only in-app way in when nothing newer is known, and the
						one that still works with auto-check off.
					</Text>
				</Stack>
				<InstallSection status={status()} onSavePrefs={noop} onOpenReleases={noop} />
			</Stack>
		</Measure>
	),
};
