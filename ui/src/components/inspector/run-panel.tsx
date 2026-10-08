import { Stack } from "@/components/layout/stack";
import { Fact } from "./fact";

export interface RunPanelProps {
	running: boolean;
	/** Messages accepted and not committed yet. */
	queued: number;
	/** What will actually run. */
	model: string;
	thinking: string;
}

/** The live facts: what the turn is doing, what is waiting, and what it will run on. */
export function RunPanel({ running, queued, model, thinking }: RunPanelProps) {
	return (
		<Stack gap="2xs">
			<Fact label="state" value={running ? "running" : "idle"} />
			<Fact label="queued" value={queued === 0 ? "" : String(queued)} />
			<Fact label="model" value={model} />
			<Fact label="thinking" value={thinking} />
		</Stack>
	);
}
