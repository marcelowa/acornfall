/**
 * Development providers: scripted stand-ins so the whole path (gateway, worker, tool loop,
 * steering, delegation) can be exercised without spending tokens and without a network.
 *
 * Two of them, because a test needs to say what the model does:
 *
 * - `ACORNFALL_DEV_PROVIDER=1` answers every user turn with one real bash call and a short
 *   reply quoting the request. Enough to exercise tools and streaming by hand.
 * - `ACORNFALL_DEV_SCRIPT=<file>` answers from a script: the first rule whose `match` is a
 *   substring of the last user message wins, and if it lists tools they are emitted before
 *   the reply. That is what makes a feature driven *by* a tool call — a guard blocking one,
 *   a subagent being spawned — testable offline instead of only by hand.
 *
 * A rule's tools are emitted once per turn: the same rule is consulted again after the tool
 * results come back, and that time it answers with its reply. Without that, every rule would
 * loop on its own tool call.
 *
 * A tool argument may be `{"$fromTranscript": "<regex>"}`: the first capture group of the last
 * match in the conversation so far. That is how a script names something only the conversation
 * knows — the id of a subagent it just made, for instance, which is what an action by id needs
 * and what a fixed script cannot spell.
 */
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	fauxAssistantMessage,
	fauxProvider,
	type FauxResponseFactory,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { readFileSync } from "node:fs";
import type { JsonObject } from "@earendil-works/pi-ai";

const REPLY_STEPS = 1000;

interface ScriptTool {
	name: string;
	args?: JsonObject;
}

interface ScriptRule {
	/** Substring of the last user message. Absent matches anything, which is the fallback. */
	match?: string;
	/** The assistant's text once the tools (if any) have run. */
	reply?: string;
	/** Tool calls emitted before the reply, in order. */
	tools?: ScriptTool[];
}

interface Script {
	/** Streaming pace. Slow it down to have time to steer while a turn runs. */
	tokensPerSecond?: number;
	tokenSize?: { min: number; max: number };
	rules?: ScriptRule[];
	fallback?: ScriptRule;
}

function lastUserText(messages: readonly { role: string; content: unknown }[]): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role !== "user") continue;
		if (typeof message.content === "string") return message.content;
		if (Array.isArray(message.content)) {
			return message.content
				.filter(
					(block): block is { type: "text"; text: string } =>
						typeof block === "object" &&
						block !== null &&
						(block as { type?: string }).type === "text",
				)
				.map((block) => block.text)
				.join(" ");
		}
		return "";
	}
	return "";
}

/** True once a tool result has arrived after the last user message: this turn is answering. */
function answeredSinceLastUser(messages: readonly { role: string; content: unknown }[]): boolean {
	const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
	return messages.slice(lastUserIndex + 1).some((message) => message.role === "toolResult");
}

/** Every text the conversation has seen, oldest first: where a script finds a runtime value. */
function transcriptText(messages: readonly { role: string; content: unknown }[]): string {
	return messages
		.map((message) => {
			if (typeof message.content === "string") return message.content;
			if (!Array.isArray(message.content)) return "";
			return message.content
				.filter(
					(block): block is { type: "text"; text: string } =>
						typeof block === "object" &&
						block !== null &&
						(block as { type?: string }).type === "text",
				)
				.map((block) => block.text)
				.join(" ");
		})
		.join("\n");
}

/**
 * Substitutes `{"$fromTranscript": "<regex>"}` wherever a tool argument carries one. A missing
 * match is a broken script, not a tool call to make with an empty id, so it throws.
 */
function resolveReferences(value: unknown, transcript: string, tool: string): unknown {
	if (Array.isArray(value)) return value.map((item) => resolveReferences(item, transcript, tool));
	if (typeof value !== "object" || value === null) return value;

	const record = value as Record<string, unknown>;
	if (typeof record.$fromTranscript === "string") {
		// The last match, because the newest value is the one a script means when a listing has
		// been read more than once.
		const expression = new RegExp(record.$fromTranscript, "g");
		let found: string | undefined;
		for (
			let match = expression.exec(transcript);
			match !== null;
			match = expression.exec(transcript)
		) {
			if (match[1] !== undefined) found = match[1];
			if (match[0] === "") expression.lastIndex += 1;
		}
		if (found === undefined) {
			throw new Error(
				`dev script: nothing in the transcript matches ${record.$fromTranscript} for ${tool}`,
			);
		}
		return found;
	}
	return Object.fromEntries(
		Object.entries(record).map(([key, item]) => [
			key,
			resolveReferences(item, transcript, tool),
		]),
	);
}

function matchRule(script: Script, request: string): ScriptRule | undefined {
	for (const rule of script.rules ?? []) {
		if (rule.match === undefined) return rule;
		if (request.includes(rule.match)) return rule;
	}
	return script.fallback;
}

const defaultRespond: FauxResponseFactory = (context) => {
	const messages = context.messages as readonly { role: string; content: unknown }[];
	const request = lastUserText(messages);

	if (!answeredSinceLastUser(messages)) {
		return fauxAssistantMessage(
			[fauxToolCall("bash", { command: "ls -la" }, { id: `dev-${Date.now()}` })],
			{
				stopReason: "toolUse",
			},
		);
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

function scriptedRespond(script: Script): FauxResponseFactory {
	return (context) => {
		const messages = context.messages as readonly { role: string; content: unknown }[];
		const request = lastUserText(messages);
		const rule = matchRule(script, request);
		if (
			rule !== undefined &&
			!answeredSinceLastUser(messages) &&
			(rule.tools?.length ?? 0) > 0
		) {
			const transcript = transcriptText(messages);
			return fauxAssistantMessage(
				(rule.tools ?? []).map((tool) =>
					fauxToolCall(
						tool.name,
						resolveReferences(tool.args ?? {}, transcript, tool.name) as JsonObject,
					),
				),
				{ stopReason: "toolUse" },
			);
		}
		// No rule matched: say so, because a script that silently answers something generic
		// makes a test pass for the wrong reason.
		const reply = rule?.reply ?? `dev script: no rule matched ${JSON.stringify(request)}`;
		return fauxAssistantMessage([fauxText(reply)]);
	};
}

function provider(respond: FauxResponseFactory, script?: Script): ReturnType<typeof fauxProvider> {
	const faux = fauxProvider({
		tokensPerSecond: script?.tokensPerSecond ?? 120,
		tokenSize: script?.tokenSize ?? { min: 3, max: 8 },
	});
	faux.setResponses(Array.from({ length: REPLY_STEPS }, () => respond));
	return faux;
}

export function devProvider(): ReturnType<typeof fauxProvider> {
	return provider(defaultRespond);
}

/** Reads the script named by ACORNFALL_DEV_SCRIPT. Throws loudly: a broken script is a test bug. */
export function scriptedDevProvider(path: string): ReturnType<typeof fauxProvider> {
	const script = JSON.parse(readFileSync(path, "utf8")) as Script;
	return provider(scriptedRespond(script), script);
}
