import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import type { SettingsTab } from "@/app/use-platform";
import { Measure } from "@/components/layout/measure";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Text } from "@/components/typography/text";
import { SettingsGroup } from "./settings-group";

/** The theme as someone chooses it: following the system is a choice, not the absence of one. */
export type ThemeChoice = "light" | "dark" | "system";

export interface SettingsScreenProps {
	/** The page in view: each has its own URL, and the tab bar follows it. */
	tab: SettingsTab;
	onTabChange: (tab: SettingsTab) => void;
	theme: ThemeChoice;
	onThemeChange: (theme: ThemeChoice) => void;
	/** The defaults section, built by the app from the pickers it already has. */
	defaults: ReactNode;
	/** The providers section: global keys, so it never sits under workspace tabs. */
	providers: ReactNode;
	/** The install-wide section: the running build, auto-check, and the door to the releases. */
	install: ReactNode;
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
 * A workspace's sandbox is not here. The image and the network belong to one workspace, and the
 * place that names workspaces is the workspaces screen, where the row's own menu opens them
 * (`SandboxDialog`). Keeping a Workspace tab here meant two places to reach the same two fields,
 * and one of them answered for whichever workspace happened to be in view.
 */
export function SettingsScreen({
	tab,
	onTabChange,
	theme,
	onThemeChange,
	defaults,
	providers,
	install,
	version,
	onClose,
}: SettingsScreenProps) {
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
							if (next === "defaults" || next === "providers" || next === "install")
								onTabChange(next);
						}}
					>
						<TabsList aria-label="Settings pages">
							<TabsTrigger value="defaults">Defaults</TabsTrigger>
							<TabsTrigger value="providers">Providers</TabsTrigger>
							<TabsTrigger value="install">Install</TabsTrigger>
						</TabsList>
					</Tabs>

					{tab === "defaults" ? (
						<>
							<SettingsGroup
								slot="settings-defaults"
								title="Defaults"
								intro={
									<Text size="2xs" tone="muted">
										What a new conversation starts from. An existing one keeps
										what it pinned.
									</Text>
								}
							>
								{defaults}
							</SettingsGroup>
							{/*
							 * Theme lives on this page rather than a tab of its own: it is one choice, and a page
							 * holding one control cost a tab in a bar that has to fit a phone.
							 */}
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
						</>
					) : null}

					{tab === "providers" ? providers : null}

					{tab === "install" ? install : null}
				</Stack>
			</Measure>
		</div>
	);
}
