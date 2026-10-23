import { CircleCheck, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { WorkspacePreparation } from "@/app/view-models";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClippedText } from "@/components/ui/clipped-text";
import { Text } from "@/components/typography/text";
import { cn } from "cn";

export interface WorkspacePreparationProps {
	preparation: WorkspacePreparation;
	/** An update is installing: the row's actions wait. */
	paused?: boolean | undefined;
	onOpen: () => void;
	onDismiss: () => void;
	onRetry: () => void;
}

/** Seconds since the preparation began, ticking only while there is something to wait for. */
function useElapsed(startedAt: number, ticking: boolean): number {
	const [seconds, setSeconds] = useState(() =>
		Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
	);
	useEffect(() => {
		if (!ticking) return;
		const update = (): void =>
			setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
		update();
		const timer = window.setInterval(update, 1000);
		return () => window.clearInterval(timer);
	}, [startedAt, ticking]);
	return seconds;
}

function elapsed(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const rest = seconds % 60;
	return `${minutes}m ${rest.toString().padStart(2, "0")}s`;
}

function badgeOf(preparation: WorkspacePreparation): {
	tone: "info" | "success" | "danger";
	label: string;
} {
	if (preparation.phase === "ready") return { tone: "success", label: "ready" };
	if (preparation.phase === "failed") return { tone: "danger", label: "could not start" };
	return { tone: "info", label: "preparing" };
}

function sentenceOf(preparation: WorkspacePreparation, seconds: number): string {
	if (preparation.phase === "ready") {
		return "It is ready. You are still in the workspace you were in.";
	}
	if (preparation.phase === "failed") {
		return preparation.reason ?? "The harness did not answer.";
	}
	return `Started ${elapsed(seconds)} ago. You can keep working here while it gets ready.`;
}

/**
 * One workspace being created, in the workspaces list. It is a row before it is a workspace:
 * the folder exists, but its harness and sandbox are still starting, so the console shows the
 * wait here instead of moving the person into a room that cannot answer yet.
 *
 * Ready is a state, not an event: the row stays until the person opens it or dismisses it, so
 * a slow start is never a notice that vanished while they were reading it.
 */
export function WorkspacePreparationRow({
	preparation,
	paused = false,
	onOpen,
	onDismiss,
	onRetry,
}: WorkspacePreparationProps) {
	const waiting = preparation.phase === "preparing";
	const seconds = useElapsed(preparation.startedAt, waiting);
	const badge = badgeOf(preparation);
	return (
		<div
			data-slot="workspace-preparation-row"
			data-phase={preparation.phase}
			className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-dashed border-border bg-card px-3 py-2"
		>
			<div className="flex min-w-0 flex-1 items-center gap-2">
				{preparation.phase === "ready" ? (
					<CircleCheck aria-hidden className="size-4 shrink-0 text-success" />
				) : preparation.phase === "failed" ? (
					<TriangleAlert aria-hidden className="size-4 shrink-0 text-destructive" />
				) : (
					<LoaderCircle
						aria-hidden
						className="size-4 shrink-0 animate-spin text-muted-foreground"
					/>
				)}
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center gap-2">
						<ClippedText
							text={preparation.name}
							className="block text-sm font-medium"
						/>
						<Badge variant="soft" tone={badge.tone} size="sm">
							{badge.label}
						</Badge>
					</div>
					<Text size="2xs" tone="muted" className="block break-words">
						{sentenceOf(preparation, seconds)}
					</Text>
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{preparation.phase === "ready" ? (
					<Button variant="outline" disabled={paused} onClick={onOpen}>
						Open
					</Button>
				) : null}
				{preparation.phase === "failed" ? (
					<Button variant="outline" disabled={paused} onClick={onRetry}>
						Try again
					</Button>
				) : null}
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label={`Dismiss ${preparation.name}`}
					disabled={paused}
					onClick={onDismiss}
				>
					<X />
				</Button>
			</div>
		</div>
	);
}

/**
 * The same preparation outside the rail: the strip above the conversation. The workspaces list
 * can be closed while a new workspace is starting, and a person who went back to their work
 * still deserves to hear that it is ready — or why it is not.
 */
export function WorkspacePreparationNotice({
	preparation,
	onOpen,
	onDismiss,
	onRetry,
}: WorkspacePreparationProps) {
	const waiting = preparation.phase === "preparing";
	const seconds = useElapsed(preparation.startedAt, waiting);
	const badge = badgeOf(preparation);
	const failed = preparation.phase === "failed";
	return (
		<div
			data-slot="workspace-preparation-notice"
			data-phase={preparation.phase}
			role={failed ? "alert" : "status"}
			aria-live={failed ? "assertive" : "polite"}
			className={cn(
				"flex flex-wrap items-center gap-2 rounded-md border px-3 py-2",
				preparation.phase === "preparing" &&
					"border-info/40 bg-info-subtle text-info-subtle-foreground",
				preparation.phase === "ready" &&
					"border-success/40 bg-success-subtle text-success-subtle-foreground",
				failed &&
					"border-destructive/40 bg-destructive-subtle text-destructive-subtle-foreground",
			)}
		>
			{preparation.phase === "ready" ? (
				<CircleCheck aria-hidden className="size-4 shrink-0" />
			) : failed ? (
				<TriangleAlert aria-hidden className="size-4 shrink-0" />
			) : (
				<LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin" />
			)}
			<span className="min-w-0 flex-1 text-sm break-words">
				<strong className="font-medium">{preparation.name}</strong>{" "}
				{preparation.phase === "ready" ? (
					"is ready."
				) : failed ? (
					`could not start: ${preparation.reason ?? "the harness did not answer"}`
				) : (
					<>
						is preparing.{" "}
						{/* The time moves every second; the live region must not, or a screen
						 * reader would read the whole strip again on every tick. */}
						<span aria-hidden="true">Started {elapsed(seconds)} ago. </span>
						You can keep working here; you can open it when it is ready.
					</>
				)}
			</span>
			<Badge variant="soft" tone={badge.tone} size="sm">
				{badge.label}
			</Badge>
			{preparation.phase === "ready" ? (
				<Button variant="secondary" size="xs" onClick={onOpen}>
					Open
				</Button>
			) : null}
			{failed ? (
				<Button variant="secondary" size="xs" onClick={onRetry}>
					Try again
				</Button>
			) : null}
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				aria-label={`Dismiss ${preparation.name}`}
				onClick={onDismiss}
			>
				<X />
			</Button>
		</div>
	);
}
