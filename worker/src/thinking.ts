/**
 * The thinking scale, and the one check for it.
 *
 * A level arrives from three directions, and only one of them is this file: an agent's
 * frontmatter, which is a file the user edits; the `thinking` argument of the subagent tool,
 * which is the model's own choice; and control's default. An unknown level is a config error
 * rather than something to hand a provider, and one function is what keeps that true of all
 * three — the delegation tools used to cast level strings into place, which is how the model's
 * argument could reach a provider unchecked.
 */
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

export const THINKING_LEVELS: ReadonlySet<ModelThinkingLevel> = new Set<ModelThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

/** The level, or null when none was given. Throws on a level outside the scale. */
export function thinkingLevelFor(value: string | undefined): ModelThinkingLevel | null {
	if (value === undefined || value.length === 0) return null;
	if (!THINKING_LEVELS.has(value as ModelThinkingLevel)) {
		throw new Error(`unknown thinking level "${value}"; expected one of ${[...THINKING_LEVELS].join(", ")}`);
	}
	return value as ModelThinkingLevel;
}
