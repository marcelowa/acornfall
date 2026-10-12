import { useState } from "react";
import type { ProviderSummary } from "@/app/view-models";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/typography/text";
import { cn } from "cn";
import { SettingsGroup } from "./settings-group";

export interface ProvidersSectionProps {
	providers: ProviderSummary[];
	onConnect?: ((provider: ProviderSummary) => void) | undefined;
	onDisconnect?: ((id: string) => void) | undefined;
	onRefresh?: (() => void) | undefined;
}

function statusLine(provider: ProviderSummary): string {
	if (!provider.authenticated) {
		if (provider.authTypes.length === 0) return "Needs a key where it runs";
		return "Not connected";
	}
	const how = provider.authType === "oauth" ? "signed in" : "key saved";
	const where = provider.source === undefined ? "" : ` · ${provider.source}`;
	return `Connected · ${how}${where} · ${provider.modelCount} models`;
}

/**
 * The providers, as settings lists them: keys are global, so this section is global too —
 * it never sits under the workspace tabs. Connected rows lead, the rest follow by name,
 * and a search narrows forty rows to the one meant. Disconnecting is two steps because a
 * deleted key, unlike a hidden conversation, does not come back.
 */
export function ProvidersSection({
	providers,
	onConnect,
	onDisconnect,
	onRefresh,
}: ProvidersSectionProps) {
	const [query, setQuery] = useState("");
	const [confirming, setConfirming] = useState<string | undefined>(undefined);
	const connected = providers.filter((provider) => provider.authenticated).length;
	const words = query.trim().toLowerCase();
	const visible =
		words === ""
			? providers
			: providers.filter(
					(provider) =>
						provider.name.toLowerCase().includes(words) ||
						provider.id.toLowerCase().includes(words),
				);

	return (
		<SettingsGroup
			slot="providers-section"
			title="Providers"
			intro={
				<Text size="2xs" tone="muted">
					Whose models this install may call. Keys are global — every workspace shares
					them.
				</Text>
			}
		>
			{connected === 0 ? (
				<Text size="sm" tone="muted">
					No provider connected. Connect one to choose models.
				</Text>
			) : null}
			<Input
				inputSize="sm"
				value={query}
				placeholder="Search providers"
				aria-label="Search providers"
				onChange={(event) => setQuery(event.target.value)}
			/>
			{visible.length === 0 ? (
				<Text size="sm" tone="muted">
					No provider matches.
				</Text>
			) : (
				<div className="flex flex-col gap-1">
					{visible.map((provider) => (
						<div
							key={provider.id}
							data-slot="provider-row"
							data-id={provider.id}
							className="flex items-center gap-2 rounded-md px-2 py-1.5"
						>
							<div className="flex min-w-0 flex-1 flex-col">
								<Text
									as="span"
									size="sm"
									weight={provider.authenticated ? "medium" : undefined}
									className={cn(
										!provider.authenticated && "text-muted-foreground",
									)}
								>
									{provider.name}
								</Text>
								<Text as="span" size="2xs" tone="muted" className="truncate">
									{statusLine(provider)}
								</Text>
							</div>
							{provider.authenticated ? (
								confirming === provider.id ? (
									<span className="flex shrink-0 items-center gap-1">
										<Button
											type="button"
											variant="destructive"
											size="sm"
											onClick={() => {
												setConfirming(undefined);
												onDisconnect?.(provider.id);
											}}
										>
											Forget key
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={() => setConfirming(undefined)}
										>
											Keep
										</Button>
									</span>
								) : provider.authTypes.length === 0 &&
								  provider.source !== undefined ? (
									// Ambient-only: the key lives outside the app, so there is
									// nothing to forget and no button pretending otherwise.
									<Text as="span" size="2xs" tone="muted" className="shrink-0">
										managed outside
									</Text>
								) : (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="shrink-0"
										onClick={() => setConfirming(provider.id)}
									>
										Disconnect
									</Button>
								)
							) : provider.authTypes.length === 0 ? (
								<Text as="span" size="2xs" tone="muted" className="shrink-0">
									set up outside the app
								</Text>
							) : (
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="shrink-0"
									onClick={() => onConnect?.(provider)}
								>
									Connect
								</Button>
							)}
						</div>
					))}
				</div>
			)}
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="self-start"
				onClick={() => onRefresh?.()}
			>
				Re-check
			</Button>
			<Text size="2xs" tone="muted">
				Added a key outside the app? Re-check reads it.
			</Text>
		</SettingsGroup>
	);
}
