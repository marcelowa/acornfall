import { useEffect, useState } from "react";
import type { WorkspaceSummary } from "@/app/view-models";
import { SettingsField } from "@/components/settings/settings-group";
import { SettingsOutcome, type SettingsOutcomeProps } from "@/components/settings/settings-outcome";
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

export interface SandboxDialogProps {
	/** The workspace whose sandbox this is, when the dialog is open. */
	workspace?: WorkspaceSummary | undefined;
	/** The last thing the server refused, in its own words. */
	failure?: string | undefined;
	onSave: (name: string, change: { image: string; network: string }) => void;
	onClose: () => void;
}

/**
 * One workspace's sandbox: what it runs, and whether it is online. It lives behind the row's own
 * menu on the workspaces screen, where the workspace is named, rather than in Settings, where a
 * "Workspace" tab answered for whichever workspace happened to be in view (see the owner's note
 * in `docs/ui-workflow/refactor-ux/11-final-pass.md`).
 *
 * The image commits from its own button and says where it landed; the network applies as it is
 * chosen. Both take effect at the next sandbox, which the line under them says.
 */
export function SandboxDialog({ workspace, failure, onSave, onClose }: SandboxDialogProps) {
	const [image, setImage] = useState(workspace?.image ?? "");
	const [network, setNetwork] = useState(workspace?.network ?? "on");
	/** The value the field last sent, so the outcome belongs to this field's own commit. */
	const [attempt, setAttempt] = useState<string | undefined>(undefined);

	// The form belongs to the workspace whose menu opened it.
	useEffect(() => {
		setImage(workspace?.image ?? "");
		setNetwork(workspace?.network ?? "on");
		setAttempt(undefined);
	}, [workspace?.name, workspace?.image, workspace?.network]);

	const committedImage = workspace?.image ?? "";
	const imageDirty = image !== committedImage;
	const outcome: SettingsOutcomeProps["state"] =
		attempt === undefined
			? undefined
			: committedImage === attempt
				? "applied"
				: failure !== undefined
					? "refused"
					: "pending";

	return (
		<Dialog
			open={workspace !== undefined}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Sandbox</DialogTitle>
					<DialogDescription className="font-mono text-2xs">
						{workspace?.path ?? ""}
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-4">
					<SettingsField label="image">
						<div className="flex items-center gap-2">
							<Input
								inputSize="sm"
								value={image}
								placeholder="the engine's default image"
								aria-label="Sandbox image"
								onChange={(event) => {
									setImage(event.target.value);
									setAttempt(undefined);
								}}
							/>
							<Button
								type="button"
								size="sm"
								disabled={!imageDirty || workspace === undefined}
								onClick={() => {
									if (workspace === undefined) return;
									setAttempt(image);
									onSave(workspace.name, { image, network });
								}}
							>
								Apply
							</Button>
						</div>
						<SettingsOutcome state={outcome} message={failure} />
					</SettingsField>
					<SettingsField label="network">
						<ToggleGroup
							type="single"
							value={network}
							onValueChange={(next) => {
								if (next !== "on" && next !== "off") return;
								if (workspace === undefined) return;
								setNetwork(next);
								onSave(workspace.name, { image, network: next });
							}}
							variant="outline"
							size="sm"
							spacing={0}
							aria-label="Sandbox network"
						>
							<ToggleGroupItem value="on">on</ToggleGroupItem>
							<ToggleGroupItem value="off">off</ToggleGroupItem>
						</ToggleGroup>
					</SettingsField>
					<Text size="2xs" tone="muted">
						Applies as chosen; the image on Apply. Either way it takes effect at the
						next sandbox.
					</Text>
				</div>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={onClose}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
