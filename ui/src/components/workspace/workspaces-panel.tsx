import { useState } from "react";
import type { WorkspaceSummary } from "@/app/view-models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RenameDialog } from "@/components/ui/rename-dialog";
import { Text } from "@/components/typography/text";
import { SandboxDialog } from "./sandbox-dialog";
import { WorkspaceRow } from "./workspace-row";

export interface WorkspacesPanelProps {
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
}

/**
 * The workspaces, one row each: open it, rename it, or forget it.
 *
 * It is a level of the rail, not a screen (run 2, and the owner's stack): the rail's head, its
 * rows and its foot are all this list while it is open, so the title above it says where the X
 * goes back to, and the width is the rail's on a desktop and the drawer's on a phone. No address
 * changes and no second layer opens over it.
 *
 * Creating one is a name, not a path: the folder is made inside the workspaces folder, and the
 * server refuses a name that would escape it. A new workspace opens with an empty conversation,
 * which is the app's doing — this content only reports the name.
 */
export function WorkspacesPanel({
	workspaces,
	onSelect,
	onCreate,
	onRename,
	onForget,
	onUpdateSandbox,
	failure,
}: WorkspacesPanelProps) {
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
		<div data-slot="workspaces-panel" className="flex min-h-0 flex-1 flex-col gap-2">
			<div
				data-slot="workspaces-list"
				className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
			>
				{workspaces.map((workspace) => (
					<WorkspaceRow
						key={workspace.name}
						workspace={workspace}
						onSelect={onSelect}
						onRename={setRenaming}
						onSandbox={setSandboxFor}
						onForget={onForget}
					/>
				))}
			</div>

			{/* The rail is narrow and the list scrolls: the form stays at the bottom, in reach
			 * under a thumb, and it wraps rather than clipping the button off the edge. */}
			<div data-slot="workspaces-create" className="flex shrink-0 flex-col gap-1">
				<div className="flex flex-wrap items-center gap-2">
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
					The folder is created inside the workspaces folder, and the new workspace opens
					with an empty conversation.
				</Text>
			</div>

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
