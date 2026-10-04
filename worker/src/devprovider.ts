/**
 * Development provider: a scripted stand-in so the whole path (gateway, worker,
 * UI, tool loop, steering) can be exercised without spending tokens.
 *
 * Enabled with ACORNFALL_DEV_PROVIDER=1. It answers each user turn with one
 * bash call and then a short reply quoting the request.
 */
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	fauxAssistantMessage,
	fauxProvider,
	type FauxResponseFactory,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";

const REPLY_STEPS = 1000;

function lastUserText(messages: readonly { role: string; content: unknown }[]): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role !== "user") continue;
		if (typeof message.content === "string") return message.content;
		if (Array.isArray(message.content)) {
			return message.content
				.filter((block): block is { type: "text"; text: string } =>
					typeof block === "object" && block !== null && (block as { type?: string }).type === "text",
				)
				.map((block) => block.text)
				.join(" ");
		}
		return "";
	}
	return "";
}

const respond: FauxResponseFactory = (context) => {
	const messages = context.messages as readonly { role: string; content: unknown }[];
	const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
	const answeredAfterUser = messages
		.slice(lastUserIndex + 1)
		.some((message) => message.role === "toolResult");
	const request = lastUserText(messages);

	if (!answeredAfterUser) {
		return fauxAssistantMessage([fauxToolCall("bash", { command: "ls -la" }, { id: `dev-${Date.now()}` })], {
			stopReason: "toolUse",
		});
	}
	const answer: AssistantMessage = fauxAssistantMessage([
		fauxText(
			[
				"Dev provider here — no model was called.",
				request === "" ? "(no request text found)" : `You said: ${request}`,
				"The bash call above really ran, in the workspace directory.",
			].join("\n\n"),
		),
	]);
	return answer;
};

export function devProvider() {
	const faux = fauxProvider({ tokensPerSecond: 120, tokenSize: { min: 3, max: 8 } });
	faux.setResponses(Array.from({ length: REPLY_STEPS }, () => respond));
	return faux;
}
