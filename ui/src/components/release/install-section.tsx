import { ChevronRight } from "lucide-react";
import type { UpdateStatus } from "@/app/client";
import { SettingsField, SettingsGroup } from "@/components/settings/settings-group";
import { Text } from "@/components/typography/text";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export interface InstallSectionProps {
	status: UpdateStatus | undefined;
	onSavePrefs: (prefs: { autoCheck?: boolean }) => void;
	onOpenReleases: () => void;
}

/**
 * Settings' install-wide page (J21): what this install runs, and how it keeps itself current.
 *
 * The running build and auto-check live here, and the Releases row is the permanent door to the
 * release page — the only in-app way in when nothing newer is known, and the one that still
 * works with auto-check off. Check now lives with the releases, not here: nothing on this page
 * installs anything.
 */
export function InstallSection({ status, onSavePrefs, onOpenReleases }: InstallSectionProps) {
	return (
		<>
			<SettingsGroup
				slot="settings-install"
				title="Install"
				intro={
					<Text size="2xs" tone="muted">
						What this install runs, and how it keeps itself current.
					</Text>
				}
			>
				<SettingsField label="running build">
					<Text size="sm" className="font-mono">
						{status === undefined ? "the gateway has not answered yet" : status.current}
					</Text>
				</SettingsField>
				<SettingsField label="auto-check">
					<ToggleGroup
						type="single"
						value={status?.autoCheck === true ? "on" : "off"}
						onValueChange={(next) => {
							if (next === "on") onSavePrefs({ autoCheck: true });
							if (next === "off") onSavePrefs({ autoCheck: false });
						}}
						variant="outline"
						size="sm"
						spacing={0}
						aria-label="Auto-check"
					>
						<ToggleGroupItem value="on">on</ToggleGroupItem>
						<ToggleGroupItem value="off">off</ToggleGroupItem>
					</ToggleGroup>
				</SettingsField>
				<Text size="2xs" tone="muted">
					On means the gateway checks releases once per hour. Off means Check now, on the
					release page, is the only check.
				</Text>
			</SettingsGroup>

			<SettingsGroup slot="settings-releases" title="Releases">
				<Button
					variant="ghost"
					className="h-auto w-full justify-start px-2 py-1.5"
					onClick={onOpenReleases}
				>
					<span className="flex min-w-0 flex-1 flex-col items-start">
						<Text as="span" size="sm">
							Releases
						</Text>
						<Text as="span" size="2xs" tone="muted">
							See what changed, and pick a version to install
						</Text>
					</span>
					<ChevronRight />
				</Button>
			</SettingsGroup>
		</>
	);
}
