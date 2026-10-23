import { LoaderCircle } from "lucide-react";

/**
 * A workspace is being woken by opening it or landing on it. The state request is also the
 * start: the harness and its sandbox boot on this fetch, and the conversation appears when the
 * gateway answers. This is a condition, not an error; it is not "harness down".
 */
export function WorkspaceWakeNotice({ name }: { name: string }) {
	return (
		<div
			data-slot="workspace-wake-notice"
			role="status"
			aria-live="polite"
			className="flex items-center gap-2 rounded-md border border-info/40 bg-info-subtle px-3 py-2 text-info-subtle-foreground"
		>
			<LoaderCircle aria-hidden className="size-4 shrink-0 animate-spin" />
			<span className="min-w-0 flex-1 text-sm break-words">
				Waking <strong className="font-medium">{name}</strong> — the harness and sandbox are
				starting. The conversation opens when it is ready.
			</span>
		</div>
	);
}
