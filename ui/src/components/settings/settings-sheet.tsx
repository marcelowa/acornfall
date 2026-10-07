import { useEffect, useState, type ReactNode } from "react";
import { Settings } from "lucide-react";
import type { WorkspaceSummary } from "@/app/view-models";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Text } from "@/components/typography/text";
import { cn } from "cn";

export interface SettingsSheetProps {
	workspace?: WorkspaceSummary | undefined;
	onUpdateWorkspace: (change: { image: string; network: string }) => void;
	workspaces: WorkspaceSummary[];
	onCreateWorkspace: (name: string) => void;
	onRemoveWorkspace: (name: string) => void;
	/** The defaults section, built by the app from the pickers it already has. */
	defaults: ReactNode;
	/** Optional: open the sheet from somewhere else (the suite does). */
	open?: boolean | undefined;
	onOpenChange?: ((open: boolean) => void) | undefined;
	className?: string | undefined;
}

/**
 * The settings, in a sheet: what this workspace is, what its defaults resolve to, and the
 * other workspaces. It starts closed — settings are not something to read on the way to a
 * conversation — and the trigger is one button rather than a row of controls.
 *
 * The workspace's image and network live here because they are decisions about the sandbox,
 * and the sheet says when they take effect instead of letting someone think a change is
 * retroactive.
 */
export function SettingsSheet({
	workspace,
	onUpdateWorkspace,
	workspaces,
	onCreateWorkspace,
	onRemoveWorkspace,
	defaults,
	open,
	onOpenChange,
	className,
}: SettingsSheetProps) {
	const [image, setImage] = useState(workspace?.image ?? "");
	const [network, setNetwork] = useState(workspace?.network ?? "on");
	const [name, setName] = useState("");

	// The form belongs to the workspace in view; a different one is a different form.
	useEffect(() => {
		setImage(workspace?.image ?? "");
		setNetwork(workspace?.network ?? "on");
	}, [workspace?.name, workspace?.image, workspace?.network]);

	// Radix wants a defined `open` when it is controlled; uncontrolled is the trigger's job.
	const controlled =
		open === undefined ? {} : onOpenChange === undefined ? { open } : { open, onOpenChange };

	return (
		<Sheet {...controlled}>
			{open === undefined ? (
				<SheetTrigger asChild>
					<Button type="button" variant="ghost" size="icon-sm" aria-label="Settings">
						<Settings />
					</Button>
				</SheetTrigger>
			) : null}
			<SheetContent
				className={cn("w-full sm:max-w-md", className)}
				aria-describedby={undefined}
			>
				<SheetHeader>
					<SheetTitle>Settings</SheetTitle>
					<SheetDescription className="sr-only">
						The workspace, its defaults, and the other workspaces.
					</SheetDescription>
				</SheetHeader>
				<div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4">
					<Stack gap="sm" data-slot="settings-workspace">
						<Text size="sm" weight="semibold">
							This workspace
						</Text>
						<Text size="2xs" tone="muted" className="font-mono">
							{workspace?.path ?? ""}
						</Text>
						<Stack gap="2xs">
							<Text size="2xs" tone="muted">
								image
							</Text>
							<Input
								inputSize="sm"
								value={image}
								placeholder="the engine's default image"
								onChange={(event) => setImage(event.target.value)}
								aria-label="Sandbox image"
							/>
						</Stack>
						<Stack gap="2xs">
							<Text size="2xs" tone="muted">
								network
							</Text>
							<ToggleGroup
								type="single"
								value={network}
								onValueChange={(next) => {
									if (next === "on" || next === "off") setNetwork(next);
								}}
								variant="outline"
								size="sm"
								spacing={0}
								aria-label="Sandbox network"
							>
								<ToggleGroupItem value="on">on</ToggleGroupItem>
								<ToggleGroupItem value="off">off</ToggleGroupItem>
							</ToggleGroup>
						</Stack>
						<Text size="2xs" tone="muted">
							A changed image or network takes effect at the next sandbox, not on the
							one that is running.
						</Text>
						<div>
							<Button
								size="sm"
								onClick={() => onUpdateWorkspace({ image, network })}
								disabled={workspace === undefined}
							>
								Save
							</Button>
						</div>
					</Stack>

					<Stack gap="sm" data-slot="settings-defaults">
						<Text size="sm" weight="semibold">
							Defaults
						</Text>
						<Text size="2xs" tone="muted">
							What runs when a conversation never chose — and which layer said so.
						</Text>
						{defaults}
					</Stack>

					<Stack gap="sm" data-slot="settings-workspaces">
						<Text size="sm" weight="semibold">
							Workspaces
						</Text>
						<div className="flex flex-col gap-1">
							{workspaces.map((item) => (
								<div
									key={item.name}
									data-slot="settings-workspace-row"
									data-name={item.name}
									className="flex items-center gap-2"
								>
									<span className="min-w-0 flex-1 truncate text-sm">
										{item.title}
									</span>
									{item.general ? null : (
										<Button
											variant="ghost"
											size="xs"
											aria-label={`Forget ${item.title}`}
											onClick={() => onRemoveWorkspace(item.name)}
										>
											Forget
										</Button>
									)}
								</div>
							))}
						</div>
						<div className="flex items-center gap-2">
							<Input
								inputSize="sm"
								value={name}
								placeholder="a folder name"
								onChange={(event) => setName(event.target.value)}
								aria-label="New workspace name"
								onKeyDown={(event) => {
									if (event.key !== "Enter" || name.trim() === "") return;
									event.preventDefault();
									onCreateWorkspace(name.trim());
									setName("");
								}}
							/>
							<Button
								size="sm"
								variant="outline"
								disabled={name.trim() === ""}
								onClick={() => {
									onCreateWorkspace(name.trim());
									setName("");
								}}
							>
								Add
							</Button>
						</div>
						<Text size="2xs" tone="muted">
							The folder is created inside the workspaces folder; a path is refused
							rather than ignored.
						</Text>
					</Stack>
				</div>
			</SheetContent>
		</Sheet>
	);
}
