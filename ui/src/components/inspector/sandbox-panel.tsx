import type { SandboxSummary } from "@/app/view-models";

export interface SandboxPanelProps {
	sandbox?: SandboxSummary | undefined;
	/** Where the active workspace keeps its bytes, when the engine reports it. */
	workspacePath?: string | undefined;
}

function Fact({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone?: "danger" | undefined;
}) {
	if (value === "") return null;
	return (
		<div className="flex gap-2 text-2xs">
			<span className="w-20 shrink-0 text-muted-foreground">{label}</span>
			<span
				className={
					tone === "danger" ? "min-w-0 break-all text-destructive" : "min-w-0 break-all"
				}
			>
				{value}
			</span>
		</div>
	);
}

/**
 * Where the tools actually run. `isolated: false` is the host engine, and the interface has
 * to be able to say so: a fallback nobody can see is a fallback nobody agreed to.
 */
export function SandboxPanel({ sandbox, workspacePath }: SandboxPanelProps) {
	if (sandbox === undefined) {
		return (
			<div className="text-2xs text-muted-foreground">
				No sandbox state yet; the workspace has not been asked for one.
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-0.5">
			<Fact
				label="engine"
				value={`${sandbox.engine}${sandbox.version === "" ? "" : ` ${sandbox.version}`}`}
			/>
			<Fact label="status" value={sandbox.status} />
			<Fact
				label="tools"
				value={sandbox.tools ? "live" : "refused"}
				tone={sandbox.tools ? undefined : "danger"}
			/>
			<Fact
				label="isolation"
				value={sandbox.isolated ? "isolated" : "the host: not isolated"}
				tone={sandbox.isolated ? undefined : "danger"}
			/>
			{sandbox.problem === undefined ? null : (
				<Fact label="problem" value={sandbox.problem} tone="danger" />
			)}
			{workspacePath === undefined ? null : <Fact label="workspace" value={workspacePath} />}
		</div>
	);
}
