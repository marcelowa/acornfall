import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import type { SettingsTab } from "@/app/use-platform";
import type { WorkspaceSummary } from "@/app/view-models";
import { Measure } from "@/components/layout/measure";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Text } from "@/components/typography/text";
import { SettingsField, SettingsGroup } from "./settings-group";
import { SettingsOutcome, type SettingsOutcomeProps } from "./settings-outcome";

/** The theme as someone chooses it: following the system is a choice, not the absence of one. */
export type ThemeChoice = "light" | "dark" | "system";

export interface SettingsScreenProps {
	/** The page in view: each has its own URL, and the tab bar follows it. */
	tab: SettingsTab;
	onTabChange: (tab: SettingsTab) => void;
	theme: ThemeChoice;
	onThemeChange: (theme: ThemeChoice) => void;
	/** The workspace in view: what its sandbox runs and where its folder is. */
	workspace?: WorkspaceSummary | undefined;
	onUpdateWorkspace: (change: { image: string; network: string }) => void;
	/** The defaults section, built by the app from the pickers it already has. */
	defaults: ReactNode;
	/** The providers section: global keys, so it never sits under workspace tabs. */
	providers: ReactNode;
	/** The update screen: release card on top, prefs below. */
	updates: ReactNode;
	/** The last thing the server refused, in its own words: the image field shows its own. */
	failure?: string | undefined;
	/** The running build, when the gateway answered: shown under the title. */
	version?: string | undefined;
	/** Back to the conversation that was in view. */
	onClose: () => void;
}

/**
 * The settings, as pages: one concern per page, each with its own URL, so a reload and a
 * shared link land where someone was. It is screens rather than a sheet because these are
 * things you go and look at — the conversation stays where it was, and the rail is the
 * way back.
 *
 * The workspace's image and network live here because they are decisions about the sandbox, and
 * the text says when they take effect instead of letting someone think a change is retroactive.
 * The workspaces themselves are on their own screen; this one is about the one in view.
 */
export function SettingsScreen({
	tab,
	onTabChange,
	theme,
	onThemeChange,
	workspace,
	onUpdateWorkspace,
	defaults,
	providers,
	updates,
	failure,
	version,
	onClose,
}: SettingsScreenProps) {
	const [image, setImage] = useState(workspace?.image ?? "");
	const [network, setNetwork] = useState(workspace?.network ?? "on");
	/**
	 * The image field's own commit: the value it sent, and whether that landed. It used to read
	 * the app's last failure, which meant any refusal anywhere printed itself as this field's.
	 */
	const [attempt, setAttempt] = useState<string | undefined>(undefined);

	// The form belongs to the workspace in view; a different one is a different form.
	useEffect(() => {
		setImage(workspace?.image ?? "");
		setNetwork(workspace?.network ?? "on");
		setAttempt(undefined);
	}, [workspace?.name, workspace?.image, workspace?.network]);

	// One model, with one exception removed: the network applies as it is chosen, and the image
	// commits from its own button and says where it landed. Nothing here waits for a blur.
	const commit = (next: { image: string; network: string }): void => {
		if (workspace === undefined) return;
		onUpdateWorkspace(next);
	};
	const committedImage = workspace?.image ?? "";
	const imageDirty = image !== committedImage;
	// The field's own outcome, derived from what it sent: applied when the committed value is
	// what it asked for, refused when the server said no, and pending while neither is true yet.
	// "Applied" therefore survives the reload that confirms it, which is exactly when the old
	// flag was cleared.
	const outcome: SettingsOutcomeProps["state"] =
		attempt === undefined
			? undefined
			: committedImage === attempt
				? "applied"
				: failure !== undefined
					? "refused"
					: "pending";

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
						<Text as="h1" size="xl" weight="semibold">
							Settings
						</Text>
						{version === undefined || version === "" ? null : (
							<Text size="2xs" tone="muted">
								acornfall {version}
							</Text>
						)}
					</Stack>

					<Tabs
						value={tab}
						onValueChange={(next) => {
							if (
								next === "workspace" ||
								next === "defaults" ||
								next === "providers" ||
								next === "appearance" ||
								next === "updates"
							)
								onTabChange(next);
						}}
					>
						<TabsList aria-label="Settings pages">
							<TabsTrigger value="workspace">Workspace</TabsTrigger>
							<TabsTrigger value="defaults">Defaults</TabsTrigger>
							<TabsTrigger value="providers">Providers</TabsTrigger>
							<TabsTrigger value="appearance">Appearance</TabsTrigger>
							<TabsTrigger value="updates">Updates</TabsTrigger>
						</TabsList>
					</Tabs>

					{tab === "appearance" ? (
						<SettingsGroup slot="settings-theme" title="Theme">
							<div>
								<ToggleGroup
									type="single"
									value={theme}
									onValueChange={(next) => {
										if (
											next === "light" ||
											next === "dark" ||
											next === "system"
										)
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
						</SettingsGroup>
					) : null}

					{tab === "workspace" ? (
						<SettingsGroup
							slot="settings-workspace"
							title="This workspace"
							intro={
								<Text size="2xs" tone="muted" className="font-mono">
									{workspace?.path ?? ""}
								</Text>
							}
						>
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
										disabled={!imageDirty}
										onClick={() => {
											setAttempt(image);
											commit({ image, network });
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
										setNetwork(next);
										commit({ image, network: next });
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
								Applies as chosen; the image on Apply. Either way it takes effect at
								the next sandbox.
							</Text>
						</SettingsGroup>
					) : null}

					{tab === "defaults" ? (
						<SettingsGroup
							slot="settings-defaults"
							title="Defaults"
							intro={
								<Text size="2xs" tone="muted">
									What a new conversation starts from. An existing one keeps what
									it pinned.
								</Text>
							}
						>
							{defaults}
						</SettingsGroup>
					) : null}

					{tab === "providers" ? providers : null}

					{tab === "updates" ? updates : null}
				</Stack>
			</Measure>
		</div>
	);
}
