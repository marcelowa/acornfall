import type { WorkspaceSummary } from "@/app/view-models";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";

export interface WorkspaceListProps {
	workspaces: WorkspaceSummary[];
	onSelect: (name: string) => void;
	className?: string | undefined;
}

/**
 * The workspaces, above the conversations: a conversation belongs to exactly one, so the
 * choice comes first. Each row says where the workspace points and what it was given — the
 * image and network it runs with — because those are decisions about the sandbox, and a
 * decision nobody can see is a decision nobody reviews.
 */
export function WorkspaceList({ workspaces, onSelect, className }: WorkspaceListProps) {
	return (
		<div data-slot="workspace-list" className={cn("flex flex-col gap-0.5", className)}>
			{workspaces.map((workspace) => (
				<button
					key={workspace.name}
					type="button"
					data-slot="workspace-row"
					data-name={workspace.name}
					data-active={workspace.active}
					aria-current={workspace.active ? "true" : undefined}
					onClick={() => onSelect(workspace.name)}
					className={cn(
						"flex min-w-0 flex-col items-start rounded-md px-2 py-1 text-left",
						workspace.active ? "bg-accent" : "hover:bg-accent/50",
					)}
				>
					<span className="flex w-full min-w-0 items-center gap-1.5">
						<span className="truncate text-sm font-medium">{workspace.title}</span>
						{workspace.general ? (
							<Badge variant="outline" size="sm">
								general
							</Badge>
						) : null}
						{workspace.network === undefined ? null : (
							<Badge variant="soft" size="sm">
								{workspace.network}
							</Badge>
						)}
						{workspace.image === undefined ? null : (
							<Badge variant="soft" size="sm" title={workspace.image}>
								image
							</Badge>
						)}
					</span>
					<span className="w-full truncate font-mono text-2xs text-muted-foreground">
						{workspace.path}
					</span>
				</button>
			))}
		</div>
	);
}
