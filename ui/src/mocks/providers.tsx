/**
 * The providers list, as run 3 proposes it. Mock-only: this file is deleted in the build step,
 * once the direction is real. It mirrors `settings/providers-section.tsx` deliberately — the
 * question it puts to the owner is the list's reading, and these are the moves that change it:
 *
 * 1. two named groups, so "what can this install use" is answered before a scroll;
 * 2. Re-check beside the search, and it says what it read — the DELEGATOR persona stops
 *    checking a control whose entire answer is silence, and J15 is the check-in;
 * 3. the state line clips, in mono, and shows itself whole on hover, focus or tap — the source
 *    of a credential can be 57 characters, and a clipped fact nobody can read is a lost fact;
 * 4. a stored credential whose check fails is its own state ("Not working · key stored"), not
 *    "Not connected" — the state the wire cannot carry yet (panel finding, `04-panel-journeys.md`);
 * 5. the search clears in one gesture, and its empty state names the catalogue's words.
 */
import { useState } from "react";
import type { ProviderSummary } from "@/app/view-models";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { ClippedText } from "@/components/ui/clipped-text";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/ui/copy-button";
import { Text } from "@/components/typography/text";
import { cn } from "cn";
import { X } from "lucide-react";

function statusLine(provider: ProviderSummary, broken: boolean): string {
	if (broken) return "Not working · key stored";
	if (!provider.authenticated) {
		if (provider.authTypes.length === 0) return "Needs a key where it runs";
		return "Not connected";
	}
	const how = provider.authType === "oauth" ? "signed in" : "key saved";
	const where = provider.source === undefined ? "" : ` · ${provider.source}`;
	const models = provider.modelCount === 1 ? "1 model" : `${provider.modelCount} models`;
	return `Connected · ${how}${where} · ${models}`;
}

function connectLabel(provider: ProviderSummary): string {
	if (provider.authTypes.includes("oauth") && !provider.authTypes.includes("api_key"))
		return "Sign in";
	if (provider.authTypes.includes("api_key") && !provider.authTypes.includes("oauth"))
		return "Add key";
	return "Connect";
}

function ProviderRow({ provider, broken }: { provider: ProviderSummary; broken: boolean }) {
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
					weight={provider.authenticated || broken ? "medium" : undefined}
					className={cn(!provider.authenticated && !broken && "text-muted-foreground")}
				>
					{provider.name}
				</Text>
				<ClippedText
					text={statusLine(provider, broken)}
					className={cn(
						"font-mono text-2xs",
						broken ? "text-warning-subtle-foreground" : "text-muted-foreground",
					)}
					side="bottom"
				/>
			</div>
			{broken ? (
				<Button type="button" variant="outline" size="sm" className="shrink-0">
					Reconnect
				</Button>
			) : provider.authenticated ? (
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

function Group({
	label,
	rows,
	broken,
}: {
	label: string;
	rows: ProviderSummary[];
	broken: Set<string>;
}) {
	if (rows.length === 0) return null;
	return (
		<Stack gap="2xs">
			<Text size="2xs" weight="medium" tone="muted">
				{label}
			</Text>
			<div className="flex flex-col gap-1">
				{rows.map((provider) => (
					<ProviderRow
						key={provider.id}
						provider={provider}
						broken={broken.has(provider.id)}
					/>
				))}
			</div>
		</Stack>
	);
}

/**
 * The address as a label instead of a URL, the panel's alternative to today's row: it read 63 of
 * 214 characters of the OpenRouter address and asked what printing the rest buys. This keeps the
 * two things that matter — the host to recognise, and Copy — and drops the part nobody reads.
 */
export function AddressLabelled({ url, instructions }: { url: string; instructions: string }) {
	const host = (() => {
		try {
			return new URL(url).host;
		} catch {
			return url;
		}
	})();
	return (
		<Stack gap="2xs">
			<Text size="sm" className="wrap-anywhere">
				{instructions}
			</Text>
			<span className="flex min-w-0 flex-wrap items-center gap-2">
				<Text as="span" size="sm" className="min-w-0 flex-1 truncate font-mono">
					Sign in at {host}
				</Text>
				<CopyButton value={url} label="Copy address" />
				<Button asChild variant="link" size="sm" className="shrink-0">
					<a href={url} target="_blank" rel="noreferrer">
						Open
					</a>
				</Button>
			</span>
		</Stack>
	);
}

export interface ProviderListProposalProps {
	rows: ProviderSummary[];
	/** Ids to show as stored-but-not-working, the state the wire cannot carry yet. */
	broken?: string[];
}

export function ProviderListProposal({ rows, broken = [] }: ProviderListProposalProps) {
	const [query, setQuery] = useState("");
	const [read, setRead] = useState(false);
	const brokenIds = new Set(broken);
	const words = query.trim().toLowerCase();
	const visible =
		words === ""
			? rows
			: rows.filter(
					(provider) =>
						provider.name.toLowerCase().includes(words) ||
						provider.id.toLowerCase().includes(words),
				);
	// Sorted by the name the row shows, not by the id: "OpenCode Zen" before "OpenCode Go" is
	// the id order, and a person reading names reads it as wrong (panel finding).
	const byName = (a: ProviderSummary, b: ProviderSummary) => a.name.localeCompare(b.name);
	const connected = visible
		.filter((provider) => provider.authenticated || brokenIds.has(provider.id))
		.sort(byName);
	const rest = visible
		.filter((provider) => !provider.authenticated && !brokenIds.has(provider.id))
		.sort(byName);
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
					onKeyDown={(event) => {
						if (event.key === "Escape") setQuery("");
					}}
				/>
				{query === "" ? null : (
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Clear the search"
						className="shrink-0"
						onClick={() => setQuery("")}
					>
						<X />
					</Button>
				)}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="shrink-0"
					onClick={() => setRead(true)}
				>
					Re-check
				</Button>
			</span>
			<Text size="2xs" tone="muted">
				{read
					? `Read ${rows.length} providers just now.`
					: "Added a key outside the app? Re-check reads it."}
			</Text>
			{visible.length === 0 ? (
				<Text size="sm" tone="muted">
					No provider matches. The list knows catalogue names — try “anthropic” or
					“bedrock”.
				</Text>
			) : (
				<>
					<Group
						label={`Connected (${connected.length})`}
						rows={connected}
						broken={brokenIds}
					/>
					<Group
						label={`Not connected (${rest.length})`}
						rows={rest}
						broken={brokenIds}
					/>
				</>
			)}
		</Stack>
	);
}
