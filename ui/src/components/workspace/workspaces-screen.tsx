import { useState } from "react";
import { ChevronLeft, Ellipsis } from "lucide-react";
import type { WorkspaceSummary } from "@/app/view-models";
import { Measure } from "@/components/layout/measure";
import { Stack } from "@/components/layout/stack";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClippedText } from "@/components/ui/clipped-text";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { RenameDialog } from "@/components/ui/rename-dialog";
import { Text } from "@/components/typography/text";
import { SandboxDialog } from "./sandbox-dialog";

export interface WorkspacesScreenProps {
	/** Every workspace, with the one in view marked. */
	workspaces: WorkspaceSummary[];
	onSelect: (name: string) => void;
	onCreate: (name: string) => void;
	onRename: (name: string, title: string) => void;
	onForget: (name: string) => void;
	/** A row's sandbox, changed from the row's own menu. */
	onUpdateSandbox: (name: string, change: { image: string; network: string }) => void;
	/** The last refusal, in the server's words: the sandbox dialog shows its own. */
	failure?: string | undefined;
	/** Back to the conversation that was in view. */
	onClose: () => void;
}

/**
 * The workspaces, one row each: open it, rename it, or forget it. It is a screen rather than a
 * sheet because it is a place you go — the conversations you were reading are behind it, and
 * the rail's top button is the way back to them.
 *
 * A row does not say whether a run is happening in it: the wire's per-workspace `running` is the
 * workspace's worker process being up (`control.go` `WorkerUp`), which is a warm process, not an
 * active turn. The mark was built on that field and taken out again — see
 * `docs/ui-workflow/refactor-ux/10-panel-look.md`. A per-workspace run flag would need the wire
 * to carry one.
 *
 * Creating one is a name, not a path: the folder is made inside the workspaces folder, and the
 * server refuses a name that would escape it. A new workspace opens with an empty conversation,
 * which is the app's doing — this screen only reports the name.
 *
 * Opening is the row's own button; renaming and forgetting live in the row's menu, the way
 * the rail's rows keep destructive gestures one step away. Forgetting is not a confirmation:
 * the general workspace cannot be forgotten, and the others are a folder that stays where
 * it is.
 */
export function WorkspacesScreen({
	workspaces,
	onSelect,
	onCreate,
	onRename,
	onForget,
	onUpdateSandbox,
	failure,
	onClose,
}: WorkspacesScreenProps) {
	const [name, setName] = useState("");
	/** The workspace being renamed, if any: the dialog is about one row at a time. */
	const [renaming, setRenaming] = useState<WorkspaceSummary | undefined>(undefined);
	/** The workspace whose sandbox is being changed, if any. */
	const [sandboxFor, setSandboxFor] = useState<WorkspaceSummary | undefined>(undefined);
	const create = (): void => {
		if (name.trim() === "") return;
		onCreate(name.trim());
		setName("");
	};

	return (
		<div data-slot="workspaces-screen" className="min-h-0 flex-1 overflow-y-auto">
			<Measure size="page" padding="lg">
				<Stack gap="lg">
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
							Workspaces
						</Text>
						<Text size="sm" tone="muted">
							A workspace is a folder with its own conversations, defaults, and
							sandbox.
						</Text>
					</Stack>

					<Stack gap="xs" data-slot="workspaces-list">
						{workspaces.map((workspace) => (
							<div
								key={workspace.name}
								data-slot="workspace-row"
								data-name={workspace.name}
								data-active={workspace.active}
								className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-border bg-card px-3 py-2"
							>
								<div className="flex min-w-0 flex-1 items-center gap-2">
									<div className="min-w-0 flex-1">
										<ClippedText
											text={workspace.title}
											className="block text-sm font-medium"
										/>
										<Text
											size="2xs"
											tone="muted"
											className="truncate font-mono"
										>
											{workspace.path}
										</Text>
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-2">
									{workspace.active ? (
										<Badge variant="soft">in view</Badge>
									) : (
										<Button
											size="xs"
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
											<DropdownMenuItem
												onSelect={() => setSandboxFor(workspace)}
											>
												Sandbox…
											</DropdownMenuItem>
											<DropdownMenuItem
												onSelect={() => setRenaming(workspace)}
											>
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
						))}
					</Stack>

					<Stack gap="2xs" data-slot="workspaces-create">
						<Text size="sm" weight="semibold">
							New workspace
						</Text>
						<div className="flex items-center gap-2">
							<Input
								inputSize="sm"
								value={name}
								placeholder="a folder name"
								aria-label="New workspace name"
								onChange={(event) => setName(event.target.value)}
								onKeyDown={(event) => {
									if (event.key !== "Enter") return;
									event.preventDefault();
									create();
								}}
							/>
							<Button
								size="sm"
								variant="outline"
								disabled={name.trim() === ""}
								onClick={create}
							>
								Create
							</Button>
						</div>
						<Text size="2xs" tone="muted">
							The folder is created inside the workspaces folder, and the new
							workspace opens with an empty conversation.
						</Text>
					</Stack>
				</Stack>
			</Measure>
			<RenameDialog
				open={renaming !== undefined}
				title="Rename workspace"
				initial={renaming?.title ?? ""}
				onSave={(title) => {
					if (renaming !== undefined) onRename(renaming.name, title);
					setRenaming(undefined);
				}}
				onCancel={() => setRenaming(undefined)}
			/>
			<SandboxDialog
				workspace={sandboxFor}
				failure={failure}
				onSave={onUpdateSandbox}
				onClose={() => setSandboxFor(undefined)}
			/>
		</div>
	);
}
