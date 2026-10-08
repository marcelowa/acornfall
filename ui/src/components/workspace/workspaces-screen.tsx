import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import type { WorkspaceSummary } from "@/app/view-models";
import { Measure } from "@/components/layout/measure";
import { Stack } from "@/components/layout/stack";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RenameDialog } from "@/components/ui/rename-dialog";
import { Text } from "@/components/typography/text";

export interface WorkspacesScreenProps {
	/** Every workspace, with the one in view marked. */
	workspaces: WorkspaceSummary[];
	onSelect: (name: string) => void;
	onCreate: (name: string) => void;
	onRename: (name: string, title: string) => void;
	onForget: (name: string) => void;
	/** Back to the conversation that was in view. */
	onClose: () => void;
}

/**
 * The workspaces, one row each: open it, rename it, or forget it. It is a screen rather than a
 * sheet because it is a place you go — the conversations you were reading are behind it, and
 * the rail's top button is the way back to them.
 *
 * Creating one is a name, not a path: the folder is made inside the workspaces folder, and the
 * server refuses a name that would escape it. A new workspace opens with an empty conversation,
 * which is the app's doing — this screen only reports the name.
 *
 * Renaming is a dialog rather than a browser prompt, and forgetting is a button rather than a
 * confirmation: the general workspace cannot be forgotten, and the others are a folder that
 * stays where it is.
 */
export function WorkspacesScreen({
	workspaces,
	onSelect,
	onCreate,
	onRename,
	onForget,
	onClose,
}: WorkspacesScreenProps) {
	const [name, setName] = useState("");
	/** The workspace being renamed, if any: the dialog is about one row at a time. */
	const [renaming, setRenaming] = useState<WorkspaceSummary | undefined>(undefined);
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
						<Text as="h1" size="lg" weight="semibold">
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
								className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
							>
								<div className="flex min-w-0 flex-1 flex-col">
									<Text size="sm" weight="medium" className="truncate">
										{workspace.title}
									</Text>
									<Text size="2xs" tone="muted" className="truncate font-mono">
										{workspace.path}
									</Text>
								</div>
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
								<Button
									size="xs"
									variant="ghost"
									aria-label={`Rename ${workspace.title}`}
									onClick={() => setRenaming(workspace)}
								>
									Rename
								</Button>
								{workspace.general ? null : (
									<Button
										size="xs"
										variant="ghost"
										aria-label={`Forget ${workspace.title}`}
										onClick={() => onForget(workspace.name)}
									>
										Forget
									</Button>
								)}
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
		</div>
	);
}
