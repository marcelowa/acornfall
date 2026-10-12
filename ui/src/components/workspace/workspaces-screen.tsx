import { useState } from "react";
import type { WorkspaceSummary } from "@/app/view-models";
import { Measure } from "@/components/layout/measure";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RenameDialog } from "@/components/ui/rename-dialog";
import { Text } from "@/components/typography/text";
import { SandboxDialog } from "./sandbox-dialog";
import { WorkspaceRow } from "./workspace-row";

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
}

/**
 * The workspaces, one row each: open it, rename it, or forget it.
 *
 * It is the content of a layer, not a screen (step 09): the layer slides in from the left under
 * the bar, carries no close of its own, and keeps no URL, so the bar's toggle, Back, or opening a
 * workspace returns to the conversation behind it. The `data-slot` name stays `workspaces-screen`
 * because the browser suite reads it.
 *
 * Creating one is a name, not a path: the folder is made inside the workspaces folder, and the
 * server refuses a name that would escape it. A new workspace opens with an empty conversation,
 * which is the app's doing — this content only reports the name.
 */
export function WorkspacesScreen({
	workspaces,
	onSelect,
	onCreate,
	onRename,
	onForget,
	onUpdateSandbox,
	failure,
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
							<WorkspaceRow
								key={workspace.name}
								workspace={workspace}
								onSelect={onSelect}
								onRename={setRenaming}
								onSandbox={setSandboxFor}
								onForget={onForget}
							/>
						))}
					</Stack>

					<Stack gap="2xs" data-slot="workspaces-create">
						<Text size="sm" weight="semibold">
							New workspace
						</Text>
						{/* It wraps: from `lg` the list is a panel the width of the rail, and a field and
						 * a button do not fit on one line there. */}
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
