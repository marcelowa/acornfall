/**
 * The release surface, as run 4 of the refactor-ux chain proposes it. Mock-only: this file is
 * deleted in the build step, once the direction is real. It mirrors what step 09 will build —
 * the product's own primitives, the wire's own shapes — and argues for the moves in
 * `refactor-ux/run-4/05-palette.md`:
 *
 * 1. the page reads running → offered → changed → cost → the press, with Install last;
 * 2. the bar carries one mark at both widths, and restart pending takes the same spot;
 * 3. notes print as prose (base), every tag is mono, every other fact is `2xs` muted;
 * 4. production readiness is a fact, not an alarm: a muted `pre` mark, never a coloured badge;
 * 5. the picker is a list of links, the running build is marked, and the cut is named.
 */
import { ArrowUp, Check, ChevronRight, RotateCw } from "lucide-react";
import { Markdown } from "@/components/transcript/markdown";
import { Measure } from "@/components/layout/measure";
import { Stack } from "@/components/layout/stack";
import { SettingsField, SettingsGroup } from "@/components/settings/settings-group";
import { Text } from "@/components/typography/text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "cn";
import { formatBytes } from "@/lib/format";
import { releaseCandidate, releases, type MockRelease } from "./release-data";

export type PageState =
	| "newer"
	| "up-to-date"
	| "restart-pending"
	| "rolled-back"
	| "refused"
	| "dev";

/** Which releases the picker is showing: GA only, or the widest list. */
export function visibleReleases(includePrerelease: boolean): MockRelease[] {
	return includePrerelease ? [releaseCandidate, ...releases] : releases;
}

/** The bar's control: one mark, two widths. The tag is a fact and stays muted. */
export function BarMark({
	state,
	tag,
	phone,
}: {
	state: "newer" | "restart-pending";
	tag?: string | undefined;
	phone?: boolean | undefined;
}) {
	if (state === "restart-pending") {
		return (
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				aria-label="Restart pending: the new build is on disk"
				className="text-warning"
			>
				<RotateCw />
			</Button>
		);
	}
	return (
		<Button
			type="button"
			variant="ghost"
			size={phone ? "icon-sm" : "sm"}
			aria-label={tag === undefined ? "Update available" : `Update available: ${tag}`}
		>
			<ArrowUp />
			{phone || tag === undefined ? null : (
				<Text as="span" size="2xs" tone="muted" className="font-mono">
					{tag}
				</Text>
			)}
		</Button>
	);
}

/** A mock top bar, so the mark is judged where it lives. */
export function Bar({ mark }: { mark: React.ReactNode }) {
	return (
		<div className="flex h-14 items-center gap-2 border-b border-border px-3">
			<Text as="span" size="sm" weight="semibold">
				acornfall
			</Text>
			<div className="min-w-0 flex-1" />
			{mark}
		</div>
	);
}

function ProductionMark({ prerelease }: { prerelease: boolean }) {
	return prerelease ? (
		<Text as="span" size="2xs" tone="muted" className="font-mono">
			pre
		</Text>
	) : null;
}

/** One row of the picker: a link to the version's page, never a control with two actions. */
export function ReleaseRow({
	release,
	running,
	current,
}: {
	release: MockRelease;
	running: string;
	current?: boolean | undefined;
}) {
	return (
		<div
			data-slot="mock-release-row"
			className={cn(
				"flex items-center gap-2 rounded-md px-2 py-1.5",
				current === true && "bg-accent/40",
			)}
		>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex min-w-0 items-center gap-1.5">
					<Text as="span" size="sm" className="font-mono">
						{release.tag}
					</Text>
					{release.tag === running ? (
						<Badge variant="soft" tone="neutral" size="sm">
							running
						</Badge>
					) : null}
					<ProductionMark prerelease={release.prerelease} />
				</div>
				<Text as="span" size="2xs" tone="muted" className="font-mono tabular-nums">
					{release.date} · {formatBytes(release.size + release.workerSize)} ·{" "}
					{release.prerelease ? "pre-release" : "production"}
				</Text>
			</div>
			{current === true ? <Check className="size-4 shrink-0 text-primary" /> : null}
		</div>
	);
}

export function Picker({
	running,
	includePrerelease,
	cut,
}: {
	running: string;
	includePrerelease: boolean;
	cut?: boolean | undefined;
}) {
	const rows = visibleReleases(includePrerelease);
	return (
		<Stack gap="sm" data-slot="mock-picker">
			<div className="flex items-center justify-between gap-2">
				<Text size="sm" weight="semibold">
					Releases
				</Text>
				<Toggle aria-label="Pre-release builds" size="sm" variant="outline">
					Pre-release builds
				</Toggle>
			</div>
			<div className="flex flex-col gap-0.5">
				{rows.map((release) => (
					<ReleaseRow key={release.tag} release={release} running={running} />
				))}
			</div>
			<Text size="2xs" tone="muted">
				{cut === true
					? "From the twenty most recent. Older changes are not listed."
					: "The twenty most recent releases. Newest first."}
			</Text>
		</Stack>
	);
}

/** The notes of every release between the running build and the target, newest first. */
function InBetween({ running, target }: { running: string; target: string }) {
	const between = releases.filter(
		(release) => release.tag !== target && release.tag > running && release.tag < target,
	);
	if (between.length === 0) return null;
	return (
		<Stack gap="xs" data-slot="mock-in-between">
			<Text size="2xs" weight="medium" tone="muted">
				what changed since {running}
			</Text>
			<Stack gap="xs">
				{between.map((release) => (
					<Stack key={release.tag} gap="2xs">
						<Text as="span" size="xs" className="font-mono">
							{release.tag}
						</Text>
						<Text as="span" size="xs" tone="muted">
							{release.notes}
						</Text>
					</Stack>
				))}
			</Stack>
		</Stack>
	);
}

function ReleaseCard({ release, running }: { release: MockRelease; running: string }) {
	const older = release.tag < running;
	return (
		<div className="rounded-lg border border-border bg-card p-3">
			<Stack gap="sm">
				<Stack gap="2xs">
					<div className="flex items-center gap-2">
						<Text as="span" size="sm" weight="semibold" className="font-mono">
							{release.tag}
						</Text>
						<ProductionMark prerelease={release.prerelease} />
					</div>
					<Text size="2xs" tone="muted" className="font-mono tabular-nums">
						{release.date} · {older ? "older than the running build · " : ""}
						{formatBytes(release.size + release.workerSize)}
					</Text>
				</Stack>
				{release.notes === "" ? (
					<Text size="base" tone="muted">
						This release shipped no notes.
					</Text>
				) : (
					<Markdown>{release.notes}</Markdown>
				)}
				{older ? (
					<InBetween running={release.tag} target={running} />
				) : (
					<InBetween running={running} target={release.tag} />
				)}
				<Text size="2xs" tone="muted">
					Backs up config, state DB, and workspace list first (last 3 kept). VM disks are
					not backed up. The update stops if backup fails.
				</Text>
				<Stack gap="2xs">
					<Text size="2xs" tone="muted">
						sandbox VMs
					</Text>
					<ToggleGroup
						type="single"
						value="keep"
						variant="outline"
						size="sm"
						spacing={0}
						aria-label="Sandbox VMs"
					>
						<ToggleGroupItem value="keep">Keep VMs</ToggleGroupItem>
						<ToggleGroupItem value="clean">Start clean</ToggleGroupItem>
					</ToggleGroup>
				</Stack>
				<div>
					<Button size="sm">Install</Button>
				</div>
			</Stack>
		</div>
	);
}

/** The state line, always a sentence, never a spinner alone (R11). */
function StateBlock({
	state,
	running,
	target,
}: {
	state: PageState;
	running: string;
	target: MockRelease;
}) {
	if (state === "newer") {
		return (
			<Stack gap="2xs" data-slot="mock-state">
				<Text size="sm" weight="semibold">
					Newer release: {target.tag}
				</Text>
				<Text size="2xs" tone="muted" className="font-mono tabular-nums">
					running {running} · newest production release {target.tag}
				</Text>
			</Stack>
		);
	}
	if (state === "up-to-date") {
		return (
			<Stack gap="2xs" data-slot="mock-state">
				<Text size="sm" weight="semibold">
					Up to date
				</Text>
				<Text size="2xs" tone="muted" className="font-mono tabular-nums">
					running {running} · the newest production release · checked 12 minutes ago
				</Text>
			</Stack>
		);
	}
	if (state === "restart-pending") {
		return (
			<Stack gap="2xs" data-slot="mock-state">
				<Badge variant="soft" tone="warning" size="sm">
					Restart pending
				</Badge>
				<Text size="xs">
					{target.tag} is on disk, the old process still answers. Restarting finishes it.
				</Text>
				<div>
					<Button size="sm" variant="outline">
						Restart
					</Button>
				</div>
			</Stack>
		);
	}
	if (state === "rolled-back") {
		return (
			<Stack gap="2xs" data-slot="mock-state">
				<Badge variant="soft" tone="danger" size="sm">
					Rolled back
				</Badge>
				<Text size="xs">
					migrate failed, rolled back: migrate {target.tag}: exit 1: cannot open
					state/state.db
				</Text>
				<Text size="2xs" tone="muted">
					{running} is running. Check the next release, or roll back by hand.
				</Text>
				<div className="flex gap-2">
					<Button size="sm" variant="outline">
						Check again
					</Button>
					<Button size="sm" variant="ghost">
						Roll back
					</Button>
				</div>
			</Stack>
		);
	}
	if (state === "refused") {
		return (
			<Stack gap="2xs" data-slot="mock-state">
				<Text size="sm" weight="semibold">
					The release source did not answer
				</Text>
				<Text size="xs">
					not found: a private repo needs ACORNFALL_GITHUB_TOKEN, or no releases exist yet
				</Text>
				<Text size="2xs" tone="muted">
					The last known release is {target.tag}; the running build is unaffected.
				</Text>
				<div>
					<Button size="sm" variant="outline">
						Check now
					</Button>
				</div>
			</Stack>
		);
	}
	return (
		<Stack gap="2xs" data-slot="mock-state">
			<Text size="sm" weight="semibold">
				dev build
			</Text>
			<Text size="2xs" tone="muted">
				Not a release tag. Releases can still be installed by hand; nothing prompts.
			</Text>
		</Stack>
	);
}

/** The whole page: head, state, the release card, the picker. */
export function ReleasePage({
	state,
	running,
	target,
	includePrerelease = false,
	showPicker = true,
	picked = false,
}: {
	state: PageState;
	running: string;
	target: MockRelease;
	includePrerelease?: boolean | undefined;
	showPicker?: boolean | undefined;
	/** A version page, opened by picking a release: the card shows in any state. */
	picked?: boolean | undefined;
}) {
	const showCard = picked || (state !== "up-to-date" && state !== "dev");
	return (
		<Measure size="page" padding="lg">
			<Stack gap="lg">
				<Stack gap="2xs">
					<Text as="h1" size="xl" weight="semibold">
						Update
					</Text>
					<Text size="2xs" tone="muted" className="font-mono">
						acornfall {running}
					</Text>
				</Stack>
				<StateBlock state={state} running={running} target={target} />
				{showCard ? <ReleaseCard release={target} running={running} /> : null}
				<Text size="2xs" tone="muted">
					<Button size="xs" variant="ghost">
						Check now
					</Button>
				</Text>
				{showPicker ? (
					<Picker
						running={running}
						includePrerelease={includePrerelease}
						cut={state === "up-to-date"}
					/>
				) : null}
			</Stack>
		</Measure>
	);
}

/** The runs dialog, with the gateway's own answer and what stopping would stop. */
export function RunsDialog({ count, workspaces }: { count: number; workspaces: string }) {
	return (
		<Dialog open>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Runs are active</DialogTitle>
					<DialogDescription>
						{count} runs are active across {workspaces}. An update restarts the gateway.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="ghost">Cancel</Button>
					<Button variant="outline">Not now</Button>
					<Button>Stop runs and install</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Settings' install-wide page: the running build, auto-check, and the door to the page. */
export function InstallSettingsPage({ running }: { running: string }) {
	return (
		<Stack gap="lg" data-slot="mock-install-settings">
			<SettingsGroup
				title="Install"
				intro={
					<Text size="2xs" tone="muted">
						What this install runs, and how it keeps itself current.
					</Text>
				}
			>
				<SettingsField label="running build">
					<Text size="sm" className="font-mono">
						acornfall {running}
					</Text>
				</SettingsField>
				<SettingsField label="auto-check">
					<ToggleGroup
						type="single"
						value="on"
						variant="outline"
						size="sm"
						spacing={0}
						aria-label="Auto-check"
					>
						<ToggleGroupItem value="on">on</ToggleGroupItem>
						<ToggleGroupItem value="off">off</ToggleGroupItem>
					</ToggleGroup>
				</SettingsField>
				<Text size="2xs" tone="muted">
					On means the gateway checks releases once per hour.
				</Text>
			</SettingsGroup>
			<SettingsGroup title="Releases">
				<button
					type="button"
					className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
				>
					<div className="flex min-w-0 flex-1 flex-col">
						<Text as="span" size="sm">
							Releases
						</Text>
						<Text as="span" size="2xs" tone="muted">
							See what changed, and pick a version to install
						</Text>
					</div>
					<ChevronRight className="size-4 shrink-0 text-muted-foreground" />
				</button>
			</SettingsGroup>
		</Stack>
	);
}
