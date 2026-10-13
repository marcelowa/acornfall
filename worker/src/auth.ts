/**
 * Provider login. pi-ai's AuthInteraction is a UI protocol, not a terminal one:
 * we project every prompt and event onto a frame and await the answer, so no
 * provider-specific knowledge exists here or in the client.
 *
 * See docs/adr/0003-provider-credentials.md.
 */
import type { AuthInteraction, AuthPrompt, Models } from "@earendil-works/pi-ai";
import { emit, log } from "./protocol.ts";
import type { AuthEvent } from "./protocol.ts";

interface PendingPrompt {
	resolve: (value: string) => void;
	reject: (error: Error) => void;
}

const pending = new Map<string, PendingPrompt>();
const controllers = new Map<string, AbortController>();

/** Answers arrive out of band: a login blocks, so its answers cannot queue behind it. */
export function resolveAuthAnswer(
	promptId: string,
	value: string | undefined,
	cancelled: boolean,
): void {
	const waiter = pending.get(promptId);
	if (waiter === undefined) return;
	pending.delete(promptId);
	if (cancelled) waiter.reject(new Error("cancelled"));
	else waiter.resolve(value ?? "");
}

export function cancelAuth(authId: string): void {
	controllers.get(authId)?.abort(new Error("cancelled"));
}

export async function login(
	models: Models,
	authId: string,
	providerId: string,
	authType: "api_key" | "oauth",
	deviceId: string,
): Promise<{ providerId: string }> {
	const controller = new AbortController();
	controllers.set(authId, controller);

	const notify = (event: AuthEvent) => emit({ type: "auth", authId, event });

	const interaction: AuthInteraction = {
		signal: controller.signal,
		prompt: (prompt: AuthPrompt) =>
			new Promise<string>((resolve, reject) => {
				const promptId = crypto.randomUUID();
				pending.set(promptId, { resolve, reject });
				notify({
					kind: "prompt",
					promptId,
					promptType: prompt.type,
					message: prompt.message,
					...(prompt.type !== "select" && prompt.placeholder !== undefined
						? { placeholder: prompt.placeholder }
						: {}),
					...(prompt.type === "select" ? { options: prompt.options } : {}),
				});
				// A prompt may carry its own signal: an out-of-band resolution, such as a
				// callback server winning a race against a manual code, cancels just this step.
				// The interface is told, because it is holding a field for an answer nobody is
				// waiting for any more — its next event may be a whole exchange away.
				prompt.signal?.addEventListener("abort", () => {
					if (!pending.delete(promptId)) return;
					notify({ kind: "prompt_cancelled", promptId });
					reject(new Error("cancelled"));
				});
				controller.signal.addEventListener("abort", () => {
					if (pending.delete(promptId)) reject(new Error("cancelled"));
				});
			}),
		notify: (event) => {
			if (event.type === "info") {
				notify({
					kind: "info",
					message: event.message,
					...(event.links === undefined ? {} : { links: event.links }),
				});
				return;
			}
			if (event.type === "auth_url") {
				notify({
					kind: "auth_url",
					url: event.url,
					...(event.instructions === undefined
						? {}
						: { instructions: event.instructions }),
				});
				return;
			}
			if (event.type === "device_code") {
				notify({
					kind: "device_code",
					userCode: event.userCode,
					verificationUri: event.verificationUri,
					...(event.intervalSeconds === undefined
						? {}
						: { intervalSeconds: event.intervalSeconds }),
					...(event.expiresInSeconds === undefined
						? {}
						: { expiresInSeconds: event.expiresInSeconds }),
				});
				return;
			}
			notify({ kind: "progress", message: event.message });
		},
	};

	try {
		// A stable id for the install: OpenAI's ChatGPT sign-in asks for it and refuses to start
		// without one, and it has to be the same value on every later call.
		await models.login(providerId, authType, interaction, { getDeviceId: () => deviceId });
		notify({ kind: "done", providerId });
		return { providerId };
	} catch (error) {
		const message = (error as Error).message;
		log(`login failed for ${providerId}: ${message}`);
		notify({ kind: "error", message });
		throw error;
	} finally {
		controllers.delete(authId);
		for (const [promptId, waiter] of pending) {
			pending.delete(promptId);
			waiter.reject(new Error("login finished"));
		}
	}
}
