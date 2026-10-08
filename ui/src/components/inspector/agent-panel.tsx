import type { WireResolvedAgent } from "@/app/wire";
import { Stack } from "@/components/layout/stack";
import { Fact } from "./fact";
import { Code } from "@/components/typography/code";
import { Text } from "@/components/typography/text";

export interface AgentPanelProps {
	/** The definition after every layer folded together, when one resolved. */
	resolved?: WireResolvedAgent | undefined;
	/** What will actually run, from the conversation's effective binding. */
	model: string;
	thinking: string;
	/** The level that was asked for when the model could not express it. */
	thinkingRequested?: string | undefined;
	sandbox?: string | undefined;
	harness?: string | undefined;
}

/**
 * Which definition resolved and which layers contributed to it — the difference between "the
 * workspace set this" and "the install did", which is what a surprising instruction needs.
 */
export function AgentPanel({
	resolved,
	model,
	thinking,
	thinkingRequested,
	sandbox,
	harness,
}: AgentPanelProps) {
	const layers = resolved?.layers ?? [];

	return (
		<Stack gap="sm">
			<Stack gap="2xs">
				<Fact label="definition" value={resolved?.name ?? "default"} />
				<Fact label="source" value={resolved?.source ?? ""} />
				<Fact label="model" value={model} />
				<Fact
					label="thinking"
					value={
						thinkingRequested !== undefined &&
						thinkingRequested !== "" &&
						thinkingRequested !== thinking
							? `${thinking} (${thinkingRequested} was asked)`
							: thinking
					}
				/>
				<Fact label="harness" value={harness ?? ""} />
				<Fact label="sandbox" value={sandbox ?? ""} />
			</Stack>
			{layers.length === 0 ? (
				<Text size="sm" tone="muted">
					No definition layers; the defaults are in force.
				</Text>
			) : (
				<Stack gap="2xs">
					<Text size="2xs" tone="muted">
						layers, in the order they folded
					</Text>
					{layers.map((layer, index) => (
						<div
							key={`${layer.layer}-${String(index)}`}
							className="flex gap-2 text-2xs"
						>
							<span className="w-20 shrink-0 font-medium">{layer.layer}</span>
							<span className="min-w-0">
								<Code>{layer.path}</Code>
							</span>
						</div>
					))}
				</Stack>
			)}
		</Stack>
	);
}
