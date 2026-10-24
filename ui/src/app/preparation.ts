import { toLifecycle } from "./map";
import type { WireLifecycle } from "./wire";

/**
 * How long a new workspace gets to answer before the console stops pretending it is still
 * coming. The first state fetch is what starts the workspace, so this covers the harness and
 * its sandbox, not only a round trip.
 */
export const PREPARATION_TIMEOUT_MS = 10 * 60 * 1000;

/** How often the console asks a workspace it is preparing whether it can be used yet. */
export const PREPARATION_POLL_MS = 1500;

export type PreparationResult =
	| { phase: "ready" }
	| { phase: "failed"; reason: string }
	| { phase: "cancelled" };

export interface PreparationWatch {
	/**
	 * Ask the workspace for its state. This is the same request the conversation screen makes,
	 * so it is also what starts the workspace and its sandbox on the server.
	 */
	fetch: (
		workspace: string,
		conversation: string,
	) => Promise<{ workerUp: boolean; lifecycle?: WireLifecycle | undefined }>;
	/** False once the person dismissed the preparation or asked to open it: stop asking. */
	isCurrent: () => boolean;
	/** Test seams; the product uses the wall clock and a real wait. */
	now?: (() => number) | undefined;
	sleep?: ((milliseconds: number) => Promise<void>) | undefined;
	intervalMs?: number | undefined;
	timeoutMs?: number | undefined;
}

/**
 * Wait until a new workspace can be used, and say how it ended.
 *
 * Creating a workspace only makes the folder; the harness and its sandbox start on the first
 * state fetch. That fetch takes a while (the whole machine boots), so the console watches it
 * here instead of taking the person out of the conversation they were in. A failed workspace
 * is reported with the gateway's own reason; a transient fetch error is retried, because a
 * workspace that has just appeared can answer before its record has settled.
 */
export async function watchWorkspacePreparation(
	workspace: string,
	options: PreparationWatch,
): Promise<PreparationResult> {
	const now = options.now ?? Date.now;
	const sleep =
		options.sleep ??
		((milliseconds: number): Promise<void> =>
			new Promise((resolve) => setTimeout(resolve, milliseconds)));
	const interval = options.intervalMs ?? PREPARATION_POLL_MS;
	const deadline = now() + (options.timeoutMs ?? PREPARATION_TIMEOUT_MS);
	let lastError = "";

	for (;;) {
		if (!options.isCurrent()) return { phase: "cancelled" };
		if (now() > deadline) {
			return {
				phase: "failed",
				reason:
					lastError === ""
						? "it did not become ready in time"
						: `${lastError} (it did not become ready in time)`,
			};
		}
		try {
			const state = await options.fetch(workspace, "");
			if (!options.isCurrent()) return { phase: "cancelled" };
			const lifecycle = toLifecycle(state);
			if (lifecycle.phase === "ready") return { phase: "ready" };
			if (lifecycle.phase === "failed") {
				return {
					phase: "failed",
					reason: lifecycle.reason ?? "the harness did not answer",
				};
			}
			lastError = "";
		} catch (cause) {
			if (!options.isCurrent()) return { phase: "cancelled" };
			lastError = cause instanceof Error ? cause.message : String(cause);
			// A workspace that was removed while it was being prepared is not going to answer,
			// and waiting for the same refusal for ten minutes helps nobody.
			if (/no workspace/.test(lastError)) return { phase: "failed", reason: lastError };
		}
		await sleep(interval);
	}
}
