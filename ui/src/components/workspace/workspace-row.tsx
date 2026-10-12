import { Ellipsis } from "lucide-react";
import type { WorkspaceSummary } from "@/app/view-models";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClippedText } from "@/components/ui/clipped-text";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Text } from "@/components/typography/text";

/**
 * One workspace: its name and folder, and the three things you can do with it. It is a
 * component rather than part of the screen because the same row is read in two places — the
 * workspaces screen and the layer the phone opens (step 06) — and the two must not drift.
 *
 * A row does not say whether a run is happening in it: the wire's per-workspace `running` is
 * the workspace's worker process being up (`control.go` `WorkerUp`), which is a warm process,
 * not an active turn. The mark was built on that field once and taken back out — see
 * `docs/ui-workflow/refactor-ux/10-panel-look.md`. A per-workspace run flag would need the
 * wire to carry one.
 */
export interface WorkspaceRowProps {
	workspace: WorkspaceSummary;
	onSelect: (name: string) => void;
	onRename: (workspace: WorkspaceSummary) => void;
	onSandbox: (workspace: WorkspaceSummary) => void;
	onForget: (name: string) => void;
}

export function WorkspaceRow({
	workspace,
	onSelect,
	onRename,
	onSandbox,
	onForget,
}: WorkspaceRowProps) {
	return (
		<div
			data-slot="workspace-row"
			data-name={workspace.name}
			data-active={workspace.active}
			className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-border bg-card px-3 py-2"
		>
			<div className="flex min-w-0 flex-1 items-center gap-2">
				<div className="min-w-0 flex-1">
					<ClippedText text={workspace.title} className="block text-sm font-medium" />
					<Text size="2xs" tone="muted" className="truncate font-mono">
						{workspace.path}
					</Text>
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{workspace.active ? (
					<Badge variant="soft">in view</Badge>
				) : (
					<Button
						variant="outline"
						aria-label={`Open ${workspace.title}`}
						onClick={() => onSelect(workspace.name)}
					>
						Open
					</Button>
				)}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={`Actions for ${workspace.title}`}
						>
							<Ellipsis />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onSelect={() => onSandbox(workspace)}>
							Sandbox…
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => onRename(workspace)}>
							Rename
						</DropdownMenuItem>
						{workspace.general ? null : (
							<DropdownMenuItem
								variant="destructive"
								onSelect={() => onForget(workspace.name)}
							>
								Forget
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}
