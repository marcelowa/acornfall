import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import type { WorkspaceSummary } from "@/app/view-models";
import { Measure } from "@/components/layout/measure";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Text } from "@/components/typography/text";

/** The theme as someone chooses it: following the system is a choice, not the absence of one. */
export type ThemeChoice = "light" | "dark" | "system";

export interface SettingsScreenProps {
	theme: ThemeChoice;
	onThemeChange: (theme: ThemeChoice) => void;
	/** The workspace in view: what its sandbox runs and where its folder is. */
	workspace?: WorkspaceSummary | undefined;
	onUpdateWorkspace: (change: { image: string; network: string }) => void;
	/** The defaults section, built by the app from the pickers it already has. */
	defaults: ReactNode;
	/** Back to the conversation that was in view. */
	onClose: () => void;
}

/**
 * The settings, as a screen: the theme, what this workspace is, and what each scope defaults
 * to. It is a screen rather than a sheet because these are things you go and look at — the
 * conversation stays where it was, and the rail is the way back.
 *
 * The workspace's image and network live here because they are decisions about the sandbox, and
 * the text says when they take effect instead of letting someone think a change is retroactive.
 * The workspaces themselves are on their own screen; this one is about the one in view.
 */
export function SettingsScreen({
	theme,
	onThemeChange,
	workspace,
	onUpdateWorkspace,
	defaults,
	onClose,
}: SettingsScreenProps) {
	const [image, setImage] = useState(workspace?.image ?? "");
	const [network, setNetwork] = useState(workspace?.network ?? "on");

	// The form belongs to the workspace in view; a different one is a different form.
	useEffect(() => {
		setImage(workspace?.image ?? "");
		setNetwork(workspace?.network ?? "on");
	}, [workspace?.name, workspace?.image, workspace?.network]);

	return (
		<div data-slot="settings-screen" className="min-h-0 flex-1 overflow-y-auto">
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
							Settings
						</Text>
					</Stack>

					<Stack gap="sm" data-slot="settings-theme">
						<Text size="sm" weight="semibold">
							Theme
						</Text>
						<div>
							<ToggleGroup
								type="single"
								value={theme}
								onValueChange={(next) => {
									if (next === "light" || next === "dark" || next === "system")
										onThemeChange(next);
								}}
								variant="outline"
								size="sm"
								spacing={0}
								aria-label="Theme"
							>
								<ToggleGroupItem value="light">Light</ToggleGroupItem>
								<ToggleGroupItem value="dark">Dark</ToggleGroupItem>
								<ToggleGroupItem value="system">System</ToggleGroupItem>
							</ToggleGroup>
						</div>
					</Stack>

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
								aria-label="Sandbox image"
								onChange={(event) => setImage(event.target.value)}
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
							Takes effect at the next sandbox.
						</Text>
						<div>
							<Button
								size="sm"
								disabled={workspace === undefined}
								onClick={() => onUpdateWorkspace({ image, network })}
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
							What a new conversation starts from. An existing one keeps what it
							pinned.
						</Text>
						{defaults}
					</Stack>
				</Stack>
			</Measure>
		</div>
	);
}
