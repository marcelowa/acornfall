import type { ContextRequest } from "@/app/context";
import { estimateTokens } from "@/app/context";
import type { WireUsage } from "@/app/wire";
import { Stack } from "@/components/layout/stack";
import { Code } from "@/components/typography/code";
import { Text } from "@/components/typography/text";
import { cn } from "cn";

export interface ContextPanelProps {
	/** The fold, oldest first; the panel shows the latest request. */
	requests: ContextRequest[];
	usage?: WireUsage | undefined;
}

function Row({ label, text }: { label: string; text: string }) {
	return (
		<details className="border-b border-border last:border-b-0">
			<summary className="cursor-pointer py-1 text-sm">
				<span className="font-mono">{label}</span>
				<span className="pl-2 text-2xs text-muted-foreground">
					{text.length} chars · ~{estimateTokens(text)} tok
				</span>
			</summary>
			<pre className="overflow-hidden pb-2 font-mono text-2xs whitespace-pre-wrap wrap-anywhere text-muted-foreground">
				{text}
			</pre>
		</details>
	);
}

/**
 * What the model saw, at the latest request: the prompt's sections after every patch folded
 * in, what changed since the request before it, and the tools it was given.
 */
export function ContextPanel({ requests, usage }: ContextPanelProps) {
	const latest = requests.at(-1);
	if (latest === undefined) {
		return (
			<Text size="sm" tone="muted">
				Nothing sent yet.
			</Text>
		);
	}

	const sections = [...latest.sections.entries()];
	const tokens = sections.reduce((sum, [, text]) => sum + estimateTokens(text), 0);
	const { changes } = latest;

	return (
		<Stack gap="sm">
			<Text size="2xs" tone="muted">
				request {requests.length} · entry {latest.entryId}
				{latest.previousId === null ? " · first" : ` · previous ${latest.previousId}`}
				<br />~{tokens} tok of sections · {latest.tools.size} tools
				{usage === undefined
					? ""
					: ` · ${usage.input} in / ${usage.output} out / ${usage.cacheRead ?? 0} cached`}
			</Text>
			<div className="flex flex-wrap gap-x-2 gap-y-1 text-2xs">
				{changes.sectionsAdded.map((name) => (
					<span key={`a-${name}`} className="text-success-subtle-foreground">
						+sections {name}
					</span>
				))}
				{changes.sectionsChanged.map((name) => (
					<span key={`c-${name}`} className="text-warning-subtle-foreground">
						~{name}
					</span>
				))}
				{changes.sectionsRemoved.map((name) => (
					<span key={`r-${name}`} className="text-destructive-subtle-foreground">
						−sections {name}
					</span>
				))}
				{changes.toolsAdded.map((name) => (
					<span key={`ta-${name}`} className="text-success-subtle-foreground">
						+tools {name}
					</span>
				))}
				{changes.toolsRemoved.map((name) => (
					<span key={`tr-${name}`} className="text-destructive-subtle-foreground">
						−tools {name}
					</span>
				))}
				{changes.sectionsAdded.length === 0 &&
				changes.sectionsChanged.length === 0 &&
				changes.sectionsRemoved.length === 0 &&
				changes.toolsAdded.length === 0 &&
				changes.toolsRemoved.length === 0 ? (
					<span className="text-muted-foreground">
						unchanged since the previous request
					</span>
				) : null}
			</div>
			{sections.length === 0 ? (
				<Text size="sm" tone="muted">
					No prompt sections.
				</Text>
			) : (
				<div>
					{sections.map(([name, text]) => (
						<Row key={name} label={name} text={text} />
					))}
				</div>
			)}
			{latest.tools.size === 0 ? null : (
				<div>
					{[...latest.tools.values()].map((tool) => (
						<Row
							key={tool.name}
							label={tool.name}
							text={JSON.stringify(tool.parameters ?? {}, null, 2)}
						/>
					))}
					<Text as="div" size="2xs" tone="muted" className={cn("pt-1")}>
						{latest.tools.size} tools in this request
					</Text>
				</div>
			)}
			<Text size="2xs" tone="muted">
				Token counts are estimated at four characters each; <Code>usage</Code> is the
				provider's own number.
			</Text>
		</Stack>
	);
}
