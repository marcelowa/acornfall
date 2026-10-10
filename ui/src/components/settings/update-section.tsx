import { useEffect, useState } from "react";
import type { UpdatePrefs, UpdateStatus } from "@/app/client";
import { Stack } from "@/components/layout/stack";
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
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Text } from "@/components/typography/text";

export interface UpdateSectionProps {
	/** The gateway's answer, if it arrived yet. */
	status: UpdateStatus | undefined;
	/** True while any conversation runs: Update now asks first. */
	runsActive: boolean;
	onCheck: () => void;
	onApply: (cleanVMs: boolean, drain: "wait" | "stop") => void;
	onRollback: () => void;
	onSavePrefs: (prefs: UpdatePrefs) => void;
	/** Later: back to the conversation that was in view. */
	onLater: () => void;
}

/**
 * The update screen and the Updates tab in one: the release card on top,
 * the prefs below. One dot, one screen, one click — and a failed update
 * says its cause instead of landing on a dead UI.
 */
export function UpdateSection({
	status,
	runsActive,
	onCheck,
	onApply,
	onRollback,
	onSavePrefs,
	onLater,
}: UpdateSectionProps) {
	const [cleanVMs, setCleanVMs] = useState(false);
	const [showNotes, setShowNotes] = useState(false);
	const [blockedOpen, setBlockedOpen] = useState(false);
	const [pinned, setPinned] = useState(status?.pinned ?? "");

	useEffect(() => {
		setPinned(status?.pinned ?? "");
	}, [status?.pinned]);

	const commitPinned = (): void => {
		onSavePrefs({ pinned });
	};

	const startUpdate = (): void => {
		// Runs active means asking first: wait for drain, stop and update,
		// or cancel. Idle means one click, drain "wait" cannot refuse.
		if (runsActive) setBlockedOpen(true);
		else onApply(cleanVMs, "wait");
	};

	return (
		<Stack gap="sm" data-slot="update-section">
			{status === undefined ? (
				<Stack gap="2xs">
					<Text size="sm" weight="semibold">
						Updates
					</Text>
					<Text size="2xs" tone="muted">
						The gateway has not answered yet.
					</Text>
					<div>
						<Button size="sm" variant="outline" onClick={onCheck}>
							Check now
						</Button>
					</div>
				</Stack>
			) : null}

			{status !== undefined && status.failed !== undefined && status.failed !== "" ? (
				<Stack gap="2xs" data-slot="update-failed">
					<Badge variant="soft" tone="danger" size="sm">
						Rolled back
					</Badge>
					<Text size="xs">{status.failed}</Text>
					<Text size="2xs" tone="muted">
						The last good build is running. Check again, or roll back by hand.
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

			{status !== undefined && (status.restartRequired ?? false) ? (
				<Stack gap="2xs" data-slot="update-restart">
					<Badge variant="soft" tone="warning" size="sm">
						Restart needed
					</Badge>
					<Text size="xs">
						{status.latest} is on disk. Restart the gateway to run it; the new binary
						migrates at boot before serving.
					</Text>
				</Stack>
			) : null}

			{status !== undefined && status.available ? (
				<Stack gap="sm" data-slot="update-release">
					<Stack gap="2xs">
						<div className="flex items-center gap-2">
							<Text size="sm" weight="semibold">
								Update ready
							</Text>
							<Badge variant="soft" tone="info" size="sm">
								1
							</Badge>
						</div>
						<Text size="xs">
							{status.current} → {status.latest}
						</Text>
					</Stack>
					{status.notes === "" ? null : (
						<Stack gap="2xs">
							<Button
								size="xs"
								variant="ghost"
								className="self-start"
								aria-expanded={showNotes}
								onClick={() => setShowNotes((show) => !show)}
							>
								{showNotes ? "Hide notes" : "View notes"}
							</Button>
							{showNotes ? <Text size="xs">{status.notes}</Text> : null}
						</Stack>
					)}
					<Text size="2xs" tone="muted">
						Backs up config, state DB, and workspace list first (last 3 kept). VM disks
						are not backed up. The update stops if backup fails.
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
							Clean wipes the sandbox root only — never files under workspaces.
						</Text>
					</Stack>
					<div className="flex gap-2">
						<Button size="sm" onClick={startUpdate}>
							Update now
						</Button>
						<Button size="sm" variant="ghost" onClick={onLater}>
							Later
						</Button>
					</div>
				</Stack>
			) : null}

			{status !== undefined && !status.available ? (
				<Stack gap="2xs" data-slot="update-current">
					<Text size="sm" weight="semibold">
						Up to date
					</Text>
					<Text size="2xs" tone="muted">
						Running {status.current}
						{status.latest === "" || status.latest === status.current
							? ""
							: ` · latest known is ${status.latest}`}
						{status.pinned === "" ? "" : ` · pinned to ${status.pinned}, so no prompts`}
					</Text>
					<div>
						<Button size="sm" variant="outline" onClick={onCheck}>
							{status.checking ? "Checking…" : "Refresh"}
						</Button>
					</div>
				</Stack>
			) : null}

			{status !== undefined ? (
				<Stack gap="sm" data-slot="update-prefs">
					<Text size="sm" weight="semibold">
						Updates tab
					</Text>
					<Stack gap="2xs">
						<Text size="2xs" tone="muted">
							channel
						</Text>
						<ToggleGroup
							type="single"
							value={status.channel === "main" ? "main" : "releases"}
							onValueChange={(next) => {
								if (next === "releases" || next === "main")
									onSavePrefs({ channel: next });
							}}
							variant="outline"
							size="sm"
							spacing={0}
							aria-label="Update channel"
						>
							<ToggleGroupItem value="releases">Releases</ToggleGroupItem>
							<ToggleGroupItem value="main">Main</ToggleGroupItem>
						</ToggleGroup>
						<Text size="2xs" tone="muted">
							Releases are tested and rollback-safe. Main builds from the local tree,
							dev hosts only.
						</Text>
					</Stack>
					<Stack gap="2xs">
						<Text size="2xs" tone="muted">
							auto-check
						</Text>
						<ToggleGroup
							type="single"
							value={status.autoCheck ? "on" : "off"}
							onValueChange={(next) => {
								if (next === "on") onSavePrefs({ autoCheck: true });
								if (next === "off") onSavePrefs({ autoCheck: false });
							}}
							variant="outline"
							size="sm"
							spacing={0}
							aria-label="Auto-check"
						>
							<ToggleGroupItem value="on">on</ToggleGroupItem>
							<ToggleGroupItem value="off">off</ToggleGroupItem>
						</ToggleGroup>
						<Text size="2xs" tone="muted">
							On means the gateway checks releases once per hour.
						</Text>
					</Stack>
					<Stack gap="2xs">
						<Text size="2xs" tone="muted">
							pinned tag
						</Text>
						<Input
							inputSize="sm"
							value={pinned}
							placeholder="no pin — prompt on new releases"
							aria-label="Pinned tag"
							onChange={(event) => setPinned(event.target.value)}
							onBlur={commitPinned}
							onKeyDown={(event) => {
								if (event.key !== "Enter") return;
								event.preventDefault();
								commitPinned();
							}}
						/>
						<Text size="2xs" tone="muted">
							Pinned means no prompts. Empty means prompt on new releases.
						</Text>
					</Stack>
				</Stack>
			) : null}

			<Dialog open={blockedOpen} onOpenChange={setBlockedOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Runs are active</DialogTitle>
						<DialogDescription>
							An update restarts the gateway. Wait for the runs to drain, stop them
							and update, or cancel.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setBlockedOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="outline"
							onClick={() => {
								setBlockedOpen(false);
								onLater();
							}}
						>
							Wait for drain
						</Button>
						<Button
							onClick={() => {
								setBlockedOpen(false);
								onApply(cleanVMs, "stop");
							}}
						>
							Stop runs and update
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</Stack>
	);
}
