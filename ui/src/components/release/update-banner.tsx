import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import type { UpdateStatus } from "@/app/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

export interface UpdateBannerProps {
	status: UpdateStatus;
	connection: "live" | "reconnecting";
	onDetails: () => void;
}

function sentence(status: UpdateStatus, connection: "live" | "reconnecting"): string {
	const target =
		status.target !== undefined && status.target !== "" ? status.target : "the new release";
	if (status.phase === "starting") {
		return connection === "reconnecting"
			? `Updating to ${target} — the machine is restarting; reconnecting.`
			: `Updating to ${target} — the new machine is starting; finishing the update.`;
	}
	if (connection === "reconnecting") {
		return `Updating to ${target} — the machine is restarting; reconnecting.`;
	}
	return `Updating to ${target} — the host is preparing the machine. Writes are paused.`;
}

/**
 * The install-wide update state, outside the update screen. It is a condition, not a notice:
 * while it is up, the console is read-only and the update screen has the detail. The phase and
 * the connection are both facts: the machine can be gone before the new console answers.
 */
export function UpdateBanner({ status, connection, onDetails }: UpdateBannerProps) {
	const failed = status.phase === "failed";
	const ready = status.phase === "ready";
	const title = failed
		? `Update to ${status.target ?? "the new release"} failed.`
		: ready
			? `${status.target ?? "The new release"} is running.`
			: sentence(status, connection);
	return (
		<div
			data-slot="update-banner"
			data-phase={status.phase}
			role={failed ? "alert" : "status"}
			aria-live={failed ? "assertive" : "polite"}
			className={cn(
				"flex flex-wrap items-center gap-2 rounded-md border px-3 py-2",
				failed
					? "border-destructive/40 bg-destructive-subtle text-destructive-subtle-foreground"
					: ready
						? "border-success/40 bg-success-subtle text-success-subtle-foreground"
						: "border-info/40 bg-info-subtle text-info-subtle-foreground",
			)}
		>
			{failed ? (
				<TriangleAlert aria-hidden className="size-4 shrink-0" />
			) : ready ? (
				<CircleCheck aria-hidden className="size-4 shrink-0" />
			) : (
				<LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin" />
			)}
			<span className="min-w-0 flex-1 text-sm break-words">
				{title}
				{failed && status.phaseReason !== undefined && status.phaseReason !== "" ? (
					<>
						{" "}
						<span className="opacity-90">{status.phaseReason}.</span>
					</>
				) : null}
			</span>
			<Badge variant="soft" tone={failed ? "danger" : ready ? "success" : "info"} size="sm">
				{failed ? "failed" : ready ? "ready" : (status.phase ?? "updating")}
			</Badge>
			<Button variant="secondary" size="xs" onClick={onDetails}>
				Details
			</Button>
		</div>
	);
}
