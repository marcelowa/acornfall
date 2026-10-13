/**
 * The providers list, as run 3 proposes it. Mock-only: this file is deleted in the build step,
 * once the direction is real. It mirrors `settings/providers-section.tsx` deliberately — the
 * question it puts to the owner is the list's reading, and the three moves below are the ones
 * that change it:
 *
 * 1. two named groups, so "what can this install use" is answered before a scroll;
 * 2. Re-check beside the search, where the person who just added a key is looking;
 * 3. the state line as clipped text that shows itself whole on hover, focus or tap — the source
 *    of a credential can be a long path, and a clipped fact nobody can read is a lost fact.
 */
import { useState } from "react";
import type { ProviderSummary } from "@/app/view-models";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { ClippedText } from "@/components/ui/clipped-text";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/typography/text";
import { cn } from "cn";

function statusLine(provider: ProviderSummary): string {
	if (!provider.authenticated) {
		if (provider.authTypes.length === 0) return "Needs a key where it runs";
		return "Not connected";
	}
	const how = provider.authType === "oauth" ? "signed in" : "key saved";
	const where = provider.source === undefined ? "" : ` · ${provider.source}`;
	return `Connected · ${how}${where} · ${provider.modelCount} models`;
}

function connectLabel(provider: ProviderSummary): string {
	if (provider.authTypes.includes("oauth") && !provider.authTypes.includes("api_key"))
		return "Sign in";
	if (provider.authTypes.includes("api_key") && !provider.authTypes.includes("oauth"))
		return "Add key";
	return "Connect";
}

function ProviderRow({ provider }: { provider: ProviderSummary }) {
	return (
		<div
			data-slot="mock-provider-row"
			data-id={provider.id}
			className="flex items-center gap-2 rounded-md px-2 py-1.5"
		>
			<div className="flex min-w-0 flex-1 flex-col">
				<Text
					as="span"
					size="sm"
					weight={provider.authenticated ? "medium" : undefined}
					className={cn(!provider.authenticated && "text-muted-foreground")}
				>
					{provider.name}
				</Text>
				<ClippedText
					text={statusLine(provider)}
					className="text-2xs text-muted-foreground"
					side="bottom"
				/>
			</div>
			{provider.authenticated ? (
				<Button type="button" variant="ghost" size="sm" className="shrink-0">
					Disconnect
				</Button>
			) : provider.authTypes.length === 0 ? (
				<Text as="span" size="2xs" tone="muted" className="shrink-0">
					set up outside the app
				</Text>
			) : (
				<Button type="button" variant="outline" size="sm" className="shrink-0">
					{connectLabel(provider)}
				</Button>
			)}
		</div>
	);
}

function Group({ label, rows }: { label: string; rows: ProviderSummary[] }) {
	if (rows.length === 0) return null;
	return (
		<Stack gap="2xs">
			<Text size="2xs" weight="medium" tone="muted">
				{label}
			</Text>
			<div className="flex flex-col gap-1">
				{rows.map((provider) => (
					<ProviderRow key={provider.id} provider={provider} />
				))}
			</div>
		</Stack>
	);
}

export function ProviderListProposal({ rows }: { rows: ProviderSummary[] }) {
	const [query, setQuery] = useState("");
	const words = query.trim().toLowerCase();
	const visible =
		words === ""
			? rows
			: rows.filter(
					(provider) =>
						provider.name.toLowerCase().includes(words) ||
						provider.id.toLowerCase().includes(words),
				);
	const connected = visible.filter((provider) => provider.authenticated);
	const rest = visible.filter((provider) => !provider.authenticated);
	return (
		<Stack gap="sm">
			<Text size="2xs" tone="muted">
				Whose models this install may call. Keys are global — every workspace shares them.
			</Text>
			<span className="flex min-w-0 items-center gap-2">
				<Input
					inputSize="sm"
					value={query}
					placeholder="Search providers"
					aria-label="Search providers"
					onChange={(event) => setQuery(event.target.value)}
				/>
				<Button type="button" variant="ghost" size="sm" className="shrink-0">
					Re-check
				</Button>
			</span>
			<Text size="2xs" tone="muted">
				Added a key outside the app? Re-check reads it.
			</Text>
			{visible.length === 0 ? (
				<Text size="sm" tone="muted">
					No provider matches.
				</Text>
			) : (
				<>
					<Group label={`Connected (${connected.length})`} rows={connected} />
					<Group label={`Not connected (${rest.length})`} rows={rest} />
				</>
			)}
		</Stack>
	);
}
