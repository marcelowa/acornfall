import { useEffect, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { fetchRelease, fetchReleases, type UpdateRelease, type UpdateStatus } from "@/app/client";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/typography/text";
import { Markdown } from "@/components/transcript/markdown";
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
import { formatBytes } from "@/lib/format";
import { cn } from "cn";

export interface ReleaseScreenProps {
	/** The gateway's own answer, from the stream summary filled by a fetch. */
	status: UpdateStatus | undefined;
	/** The release the URL names; empty means the newest production release. */
	tag: string;
	/** An apply is in flight: the button says so until it settles. */
	applying: boolean;
	/** Open a release's own page. */
	onOpenTag: (tag: string) => void;
	/** Back to the conversation behind the screen. */
	onClose: () => void;
	onCheck: () => void;
	onRefresh: () => void;
	onApply: (tag: string, cleanVMs: boolean, drain: "wait" | "stop") => void;
	onRestart: () => void;
	onRollback: () => void;
	/** The reads the page owns. Tests and stories hand in fixtures; the app omits them. */
	loadReleases?: typeof fetchReleases | undefined;
	loadRelease?: typeof fetchRelease | undefined;
}

/** How many release reads the in-between list may make: the window's own size. */
const BETWEEN_LIMIT = 20;

/**
 * The release page: running → offered → changed → cost → the press (J16–J19).
 *
 * It owns the reads the status does not carry — the list, the target's notes, the running row's
 * facts when it is older than the list, and the notes in between — because they are the page's
 * own content and nobody else reads them. Every version it shows says what it is next to the
 * running build, and it decides none of that itself: the gateway's `relation` says it (R6, R7).
 */
export function ReleaseScreen({
	status,
	tag,
	applying,
	onOpenTag,
	onClose,
	onCheck,
	onRefresh,
	onApply,
	onRestart,
	onRollback,
	loadReleases = fetchReleases,
	loadRelease = fetchRelease,
}: ReleaseScreenProps) {
	const [prereleases, setPrereleases] = useState(false);
	const [releases, setReleases] = useState<UpdateRelease[] | undefined>(undefined);
	const [listError, setListError] = useState<string | undefined>(undefined);
	const [target, setTarget] = useState<UpdateRelease | undefined>(undefined);
	const [targetError, setTargetError] = useState<string | undefined>(undefined);
	const [runningRow, setRunningRow] = useState<UpdateRelease | undefined>(undefined);
	const [between, setBetween] = useState<UpdateRelease[]>([]);
	const [cleanVMs, setCleanVMs] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);

	// The reads are props so stories and tests can hand in fixtures; a ref keeps
	// them out of the effects' dependencies, where an inline loader would re-run
	// the effect on every render.
	const loaders = useRef({ loadReleases, loadRelease });
	loaders.current = { loadReleases, loadRelease };

	const current = status?.current ?? "";
	const isTag = current !== "" && current !== "dev";
	const newestGa = releases?.find((release) => !release.prerelease)?.tag ?? "";
	const targetTag = tag !== "" ? tag : newestGa !== "" ? newestGa : (status?.latest ?? "");

	// The list: one fetch on open, and one per switch turn — the filter is the
	// server's, so turning the switch refetches rather than hiding rows.
	useEffect(() => {
		let cancelled = false;
		const load = async (): Promise<void> => {
			try {
				const next = await loaders.current.loadReleases(prereleases);
				if (cancelled) return;
				setReleases(next);
				setListError(undefined);
			} catch (error) {
				if (!cancelled)
					setListError(error instanceof Error ? error.message : String(error));
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [prereleases]);
	// The target's own read: notes, date, size, relation. The list carries no
	// notes — GitHub bodies are null for every release so far — so the page asks
	// by name.
	useEffect(() => {
		if (targetTag === "") return;
		let cancelled = false;
		if (releases !== undefined && releases.some((release) => release.tag === targetTag)) {
			if (!cancelled) setTargetError(undefined);
		}
		void loaders.current.loadRelease(targetTag).then(
			(release) => {
				if (!cancelled) {
					setTarget(release);
					setTargetError(undefined);
				}
			},
			(error: unknown) => {
				if (!cancelled)
					setTargetError(error instanceof Error ? error.message : String(error));
			},
		);
		return () => {
			cancelled = true;
		};
	}, [targetTag, releases]);
	// The running build, when it is older than the list: its own row, by name.
	useEffect(() => {
		if (!isTag) return;
		if (releases !== undefined && releases.some((release) => release.tag === current)) return;
		let cancelled = false;
		void loaders.current.loadRelease(current).then(
			(release) => {
				if (!cancelled) setRunningRow(release);
			},
			() => undefined,
		);
		return () => {
			cancelled = true;
		};
	}, [current, isTag, releases]);

	// The changes in between: every release newer than the running build but
	// not the target, inside the fetched window, newest first — so a jump of
	// several versions reads as one list of changes.
	useEffect(() => {
		if (target?.relation !== "newer" || releases === undefined) {
			setBetween([]);
			return;
		}
		const rows = releases
			.filter((release) => release.relation === "newer" && release.tag !== target.tag)
			.slice(0, BETWEEN_LIMIT);
		if (rows.length === 0) {
			setBetween([]);
			return;
		}
		let cancelled = false;
		void Promise.all(rows.map((release) => loaders.current.loadRelease(release.tag))).then(
			(loaded) => {
				if (!cancelled) setBetween(loaded);
			},
			() => undefined,
		);
		return () => {
			cancelled = true;
		};
	}, [releases, target]);

	// Follow the swap and the restart until the gateway answers with the new
	// build: any amount of waiting, and no give-up timer deciding what the page
	// claims (R11). Once the running build is the target, there is nothing to
	// follow.
	const watching = applying || status?.restartRequired === true;
	useEffect(() => {
		if (!watching) return;
		if (current !== "" && current === targetTag) return;
		const timer = window.setInterval(onRefresh, 3000);
		return () => window.clearInterval(timer);
	}, [watching, current, targetTag, onRefresh]);

	const startUpdate = (): void => {
		if (status?.runsActive === true) {
			setDialogOpen(true);
			return;
		}
		onApply(targetTag, cleanVMs, "wait");
	};

	const runs = status?.runs ?? [];
	const runCount = runs.reduce((total, item) => total + item.runs, 0);
	const workspaces = runs.map((item) => item.workspace).join(", ");

	return (
		<div data-slot="release-screen" className="min-h-0 flex-1 overflow-y-auto">
			<Stack gap="lg" padding="lg" className="mx-auto w-full max-w-page">
				<Stack gap="2xs">
					<Button
						variant="ghost"
						size="xs"
						className="self-start"
						aria-label="Back to the conversation"
						onClick={onClose}
					>
						<ChevronLeft />
						Back to the conversation
					</Button>
					<Text as="h1" size="xl" weight="semibold">
						Update
					</Text>
					<Text size="2xs" tone="muted" className="font-mono">
						{isTag ? `acornfall ${current}` : "dev build — not a release tag"}
					</Text>
				</Stack>

				<StateLine
					status={status}
					target={target}
					tag={tag}
					checking={status?.checking === true}
					applying={applying}
					listError={listError}
					onCheck={onCheck}
					onRestart={onRestart}
				/>

				{status?.failed !== undefined && status.failed !== "" ? (
					<Stack gap="2xs" data-slot="release-rolled-back">
						<Badge variant="soft" tone="danger" size="sm">
							Rolled back
						</Badge>
						<Text size="xs">{status.failed}</Text>
						<Text size="2xs" tone="muted">
							{current} is running. Check the next release, or roll back by hand.
						</Text>
						<div className="flex gap-2">
							<Button size="sm" variant="outline" onClick={onCheck}>
								Check again
							</Button>
							<Button size="sm" variant="ghost" onClick={onRollback}>
								Roll back
							</Button>
						</div>
					</Stack>
				) : null}

				{targetError !== undefined ? (
					<Stack gap="2xs" data-slot="release-missing">
						<Text size="sm" weight="semibold">
							No such release
						</Text>
						<Text size="xs">{targetError}</Text>
						<div className="flex gap-2">
							<Button size="sm" variant="outline" onClick={onCheck}>
								Check now
							</Button>
						</div>
					</Stack>
				) : null}

				{status?.restartRequired === true ? (
					<Stack gap="2xs" data-slot="release-restart">
						<Badge variant="soft" tone="warning" size="sm">
							Restart pending
						</Badge>
						<Text size="xs">
							The new build is on disk and the old process still answers. Restarting
							finishes it.
						</Text>
						<div>
							<Button size="sm" variant="outline" onClick={onRestart}>
								Restart
							</Button>
						</div>
					</Stack>
				) : null}

				{target !== undefined &&
				targetError === undefined &&
				(status?.failed === undefined || status.failed === "") ? (
					<Stack gap="sm" data-slot="release-card">
						<div className="rounded-lg border border-border bg-card p-3">
							<Stack gap="sm">
								<Stack gap="2xs">
									<div className="flex items-center gap-2">
										<Text
											as="span"
											size="sm"
											weight="semibold"
											className="font-mono"
										>
											{target.tag}
										</Text>
										{target.prerelease ? (
											<Text
												as="span"
												size="2xs"
												tone="muted"
												className="font-mono"
											>
												pre
											</Text>
										) : null}
										{target.relation === "running" ? (
											<Badge variant="soft" tone="neutral" size="sm">
												running
											</Badge>
										) : null}
									</div>
									<Text
										size="2xs"
										tone="muted"
										className="font-mono tabular-nums"
									>
										{target.publishedAt.slice(0, 10)}
										{target.relation === "older"
											? " · older than the running build"
											: ""}
										{target.relation === "unknown"
											? " · not a release tag"
											: ""}
										{" · "}
										{formatBytes(target.downloadSize + target.workerSize)}
									</Text>
								</Stack>
								{target.notes === "" ? (
									<Text size="base" tone="muted">
										This release shipped no notes.
									</Text>
								) : (
									<Markdown>{target.notes}</Markdown>
								)}
								{between.length > 0 ? <Between releases={between} /> : null}
								<Text size="2xs" tone="muted">
									Backs up config, state DB, and workspace list first (last 3
									kept). VM disks are not backed up. The update stops if backup
									fails. The window reloads when the new build answers; a draft is
									not kept.
								</Text>
								<Stack gap="2xs">
									<Text size="2xs" tone="muted">
										sandbox VMs
									</Text>
									<ToggleGroup
										type="single"
										value={cleanVMs ? "clean" : "keep"}
										onValueChange={(next) => {
											if (next === "keep") setCleanVMs(false);
											if (next === "clean") setCleanVMs(true);
										}}
										variant="outline"
										size="sm"
										spacing={0}
										aria-label="Sandbox VMs"
									>
										<ToggleGroupItem value="keep">Keep VMs</ToggleGroupItem>
										<ToggleGroupItem value="clean">Start clean</ToggleGroupItem>
									</ToggleGroup>
									<Text size="2xs" tone="muted">
										Clean wipes the sandbox root only — never files under
										workspaces.
									</Text>
								</Stack>
								<div>
									<Button
										size="sm"
										onClick={startUpdate}
										disabled={applying || target.relation === "running"}
									>
										{applying ? "Installing…" : "Install"}
									</Button>
								</div>
							</Stack>
						</div>
					</Stack>
				) : null}

				<Button size="xs" variant="ghost" className="self-start" onClick={onCheck}>
					{status?.checking === true ? "Checking…" : "Check now"}
				</Button>

				<Stack gap="sm" data-slot="release-picker">
					<div className="flex items-center justify-between gap-2">
						<Text size="sm" weight="semibold">
							Releases
						</Text>
						<Toggle
							aria-label="Pre-release builds"
							size="sm"
							variant="outline"
							pressed={prereleases}
							onPressedChange={setPrereleases}
						>
							Pre-release builds
						</Toggle>
					</div>
					{listError !== undefined ? (
						<Text size="xs">{listError}</Text>
					) : (
						<div className="flex flex-col gap-0.5">
							{isTag && runningRow !== undefined ? (
								<ReleaseRow release={runningRow} current onOpen={onOpenTag} />
							) : null}
							{(releases ?? []).map((release) => (
								<ReleaseRow
									key={release.tag}
									release={release}
									current={release.tag === targetTag}
									onOpen={onOpenTag}
								/>
							))}
						</div>
					)}
					<Text size="2xs" tone="muted">
						{isTag && runningRow !== undefined
							? "From the twenty most recent. Older changes are not listed."
							: "The twenty most recent releases. Newest first."}
					</Text>
				</Stack>
			</Stack>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Runs are active</DialogTitle>
						<DialogDescription>
							{runCount > 0
								? `${runCount} runs are active across ${workspaces}. An update restarts the gateway.`
								: "Runs are active. An update restarts the gateway."}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setDialogOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="outline"
							onClick={() => {
								setDialogOpen(false);
								onClose();
							}}
						>
							Not now
						</Button>
						<Button
							disabled={applying}
							onClick={() => {
								setDialogOpen(false);
								onApply(targetTag, cleanVMs, "stop");
							}}
						>
							{applying ? "Installing…" : "Stop runs and install"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

/** The changes between the running build and the target, newest first. */
function Between({ releases }: { releases: UpdateRelease[] }) {
	return (
		<Stack gap="xs" data-slot="release-between">
			<Text size="2xs" weight="medium" tone="muted">
				what changed in between
			</Text>
			<Stack gap="xs">
				{releases.map((release) => (
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

/** One row of the picker: a link to the version's page, never a control with two actions. */
function ReleaseRow({
	release,
	current,
	onOpen,
}: {
	release: UpdateRelease;
	current?: boolean | undefined;
	onOpen: (tag: string) => void;
}) {
	return (
		<button
			type="button"
			data-slot="release-row"
			onClick={() => onOpen(release.tag)}
			className={cn(
				"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
				current === true && "bg-accent/40",
			)}
		>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex min-w-0 items-center gap-1.5">
					<Text as="span" size="sm" className="font-mono">
						{release.tag}
					</Text>
					{release.relation === "running" ? (
						<Badge variant="soft" tone="neutral" size="sm">
							running
						</Badge>
					) : null}
					{release.prerelease ? (
						<Text as="span" size="2xs" tone="muted" className="font-mono">
							pre
						</Text>
					) : null}
				</div>
				<Text as="span" size="2xs" tone="muted" className="font-mono tabular-nums">
					{release.publishedAt.slice(0, 10)} ·{" "}
					{formatBytes(release.downloadSize + release.workerSize)} ·{" "}
					{release.prerelease ? "pre-release" : "production"}
				</Text>
			</div>
		</button>
	);
}

/** The state line, always a sentence, never a spinner alone (R11). */
function StateLine({
	status,
	target,
	tag,
	checking,
	applying,
	listError,
	onCheck,
	onRestart,
}: {
	status: UpdateStatus | undefined;
	target: UpdateRelease | undefined;
	tag: string;
	checking: boolean;
	applying: boolean;
	listError: string | undefined;
	onCheck: () => void;
	onRestart: () => void;
}) {
	if (status === undefined) {
		return (
			<Stack gap="2xs" data-slot="release-state">
				<Text size="sm" weight="semibold">
					The gateway has not answered yet
				</Text>
				<Text size="2xs" tone="muted">
					The release page reads its state from the gateway. Check again in a moment.
				</Text>
				<div>
					<Button size="sm" variant="outline" onClick={onCheck}>
						Check now
					</Button>
				</div>
			</Stack>
		);
	}
	if (applying) {
		return (
			<Stack gap="2xs" data-slot="release-state">
				<Text size="sm" weight="semibold">
					Installing {target?.tag ?? "the release"}
				</Text>
				<Text size="2xs" tone="muted">
					Backup, download, verify, then runs stop and the build swaps. The page follows
					until the new build answers.
				</Text>
			</Stack>
		);
	}
	if (status.restartRequired === true) {
		return (
			<Stack gap="2xs" data-slot="release-state">
				<Text size="sm" weight="semibold">
					Restart pending
				</Text>
				<Text size="2xs" tone="muted" className="font-mono tabular-nums">
					running {status.current} · the files are swapped, the old process still answers
				</Text>
				<div>
					<Button size="sm" variant="outline" onClick={onRestart}>
						Restart
					</Button>
				</div>
			</Stack>
		);
	}
	if (status.current === "dev") {
		return (
			<Stack gap="2xs" data-slot="release-state">
				<Text size="sm" weight="semibold">
					dev build
				</Text>
				<Text size="2xs" tone="muted">
					Not a release tag. Releases can still be installed by hand; nothing prompts.
				</Text>
			</Stack>
		);
	}
	if (status.failed !== undefined && status.failed !== "") {
		return null;
	}
	if (status.available) {
		return (
			<Stack gap="2xs" data-slot="release-state">
				<Text size="sm" weight="semibold">
					Newer release: {target?.tag ?? status.latest}
				</Text>
				<Text size="2xs" tone="muted" className="font-mono tabular-nums">
					running {status.current} · newest production release {status.latest}
					{checking ? " · checking…" : ""}
				</Text>
			</Stack>
		);
	}
	return (
		<Stack gap="2xs" data-slot="release-state">
			<Text size="sm" weight="semibold">
				{tag === "" ? "Up to date" : `Version ${tag}`}
			</Text>
			<Text size="2xs" tone="muted" className="font-mono tabular-nums">
				running {status.current}
				{status.latest === "" ? "" : ` · newest production release ${status.latest}`}
				{checking ? " · checking…" : ""}
			</Text>
			{listError === undefined ? null : <Text size="xs">{listError}</Text>}
		</Stack>
	);
}
