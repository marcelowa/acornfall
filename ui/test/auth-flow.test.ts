import { describe, expect, test } from "bun:test";
import {
	authFlowAnswerFailed,
	authFlowAnswered,
	authFlowStarted,
	foldAuthEvent,
	rememberAuthEvent,
	takeAuthEvents,
	type AuthFlow,
	type AuthWaiting,
} from "../src/app/auth-flow";
import type { ProviderSummary } from "../src/app/view-models";
import type { WireAuthEvent } from "../src/app/wire";

const provider: ProviderSummary = {
	id: "openrouter",
	name: "OpenRouter",
	authenticated: false,
	authTypes: ["api_key", "oauth"],
	modelCount: 0,
};

const prompt: WireAuthEvent = {
	kind: "prompt",
	promptId: "p-1",
	promptType: "manual_code",
	message: "Paste the redirect URL",
};

const base = authFlowStarted("auth-1", provider, "oauth", []);

function fold(...events: WireAuthEvent[]): AuthFlow {
	return events.reduce(foldAuthEvent, base);
}

describe("authFlowStarted", () => {
	test("a flow starts empty and waiting", () => {
		expect(base).toEqual({
			authId: "auth-1",
			provider,
			method: "oauth",
			notices: [],
			answering: false,
			answered: false,
		});
	});

	test("frames that arrived before the flow was named land as if they came after", () => {
		// The race the buffer exists for: a worker answers a login start before the HTTP reply
		// that names the flow, so the prompt is already in hand when the dialog opens.
		const early: WireAuthEvent[] = [
			{ kind: "progress", message: "Listening…" },
			{ kind: "auth_url", url: "https://openrouter.ai/auth?x=1", instructions: "Sign in." },
			prompt,
		];
		const started = authFlowStarted("auth-1", provider, "oauth", early);
		expect(started.prompt?.promptId).toBe("p-1");
		expect(started.notices).toHaveLength(1);
		expect(started.progress).toBe("Listening…");
	});
});

describe("foldAuthEvent", () => {
	test("progress is one line, replaced as the flow moves", () => {
		const flow = fold(
			{ kind: "progress", message: "Listening for the callback…" },
			{ kind: "progress", message: "Exchanging the code…" },
		);
		expect(flow.progress).toBe("Exchanging the code…");
		expect(flow.notices).toEqual([]);
	});

	test("a second URL supersedes the first", () => {
		const flow = fold(
			{ kind: "auth_url", url: "https://one" },
			{ kind: "auth_url", url: "https://two" },
		);
		expect(flow.notices).toEqual([{ kind: "auth_url", url: "https://two" }]);
	});

	test("the same info line is said once", () => {
		const flow = fold(
			{ kind: "info", message: "Opening a browser window." },
			{ kind: "info", message: "Opening a browser window." },
			{ kind: "info", message: "Waiting for approval." },
		);
		expect(flow.notices.map((notice) => notice.kind)).toEqual(["info", "info"]);
	});

	test("a prompt replaces the prompt before it", () => {
		const flow = fold(prompt, {
			kind: "prompt",
			promptId: "p-2",
			promptType: "secret",
			message: "Enter the key",
		});
		expect(flow.prompt?.promptId).toBe("p-2");
	});

	test("any event means the answer in flight has landed", () => {
		const flow = fold({ ...prompt, kind: "progress", message: "Exchanging the code…" });
		expect(flow.answering).toBe(false);
	});

	test("done and error end the flow and clear the question", () => {
		const done = fold(prompt, { kind: "done", providerId: "openrouter" });
		expect(done.outcome).toEqual({ ok: true });
		expect(done.prompt).toBeUndefined();

		const failed = fold(prompt, { kind: "error", message: "invalid code" });
		expect(failed.outcome).toEqual({ ok: false, message: "invalid code" });
		expect(failed.prompt).toBeUndefined();
	});
});

describe("answering", () => {
	test("a landed answer clears the question and says what is left to do", () => {
		const flow = authFlowAnswered(fold(prompt));
		expect(flow.prompt).toBeUndefined();
		expect(flow.answered).toBe(true);
		expect(flow.answering).toBe(false);
	});

	test("a refused answer keeps the question, so it can be given again", () => {
		const flow = authFlowAnswerFailed({ ...fold(prompt), answering: true });
		expect(flow.prompt?.promptId).toBe("p-1");
		expect(flow.answering).toBe(false);
		expect(flow.answered).toBe(false);
	});
});

describe("a prompt the provider resolved itself", () => {
	test("goes from the dialog, and the flow reads as past the question", () => {
		// The callback server won the race against the paste: the field is asking for an answer
		// nobody is waiting on, and the next step may be a whole exchange away.
		const flow = fold(prompt, { kind: "prompt_cancelled", promptId: "p-1" });
		expect(flow.prompt).toBeUndefined();
		expect(flow.answered).toBe(true);
		expect(flow.answering).toBe(false);
	});

	test("is not this flow's business when it names another prompt", () => {
		const flow = fold(prompt, { kind: "prompt_cancelled", promptId: "p-other" });
		expect(flow.prompt?.promptId).toBe("p-1");
		expect(flow.answered).toBe(false);
	});

	test("does not push an earlier answer aside", () => {
		const answered = authFlowAnswered(fold(prompt));
		const later = foldAuthEvent(answered, { kind: "prompt_cancelled", promptId: "p-1" });
		expect(later.prompt).toBeUndefined();
		expect(later.answered).toBe(true);
	});
});

describe("the waiting room", () => {
	test("frames wait by auth id and leave in the order they arrived", () => {
		const waiting: AuthWaiting = new Map();
		rememberAuthEvent(waiting, "auth-1", { kind: "progress", message: "one" });
		rememberAuthEvent(waiting, "auth-1", prompt);
		rememberAuthEvent(waiting, "auth-2", { kind: "progress", message: "other" });

		expect(takeAuthEvents(waiting, "auth-1")).toEqual([
			{ kind: "progress", message: "one" },
			prompt,
		]);
		// Taken once: the flow owns them now.
		expect(takeAuthEvents(waiting, "auth-1")).toEqual([]);
		expect(takeAuthEvents(waiting, "auth-2")).toHaveLength(1);
	});

	test("a flow nobody claims is forgotten, oldest first", () => {
		const waiting: AuthWaiting = new Map();
		for (let index = 0; index < 10; index += 1) {
			rememberAuthEvent(waiting, `auth-${index}`, {
				kind: "progress",
				message: String(index),
			});
		}
		expect(waiting.size).toBe(8);
		expect(waiting.has("auth-0")).toBe(false);
		expect(waiting.has("auth-9")).toBe(true);
	});

	test("one flow's frames are bounded too", () => {
		const waiting: AuthWaiting = new Map();
		for (let index = 0; index < 40; index += 1) {
			rememberAuthEvent(waiting, "auth-1", {
				kind: "progress",
				message: String(index),
			});
		}
		const events = takeAuthEvents(waiting, "auth-1");
		expect(events).toHaveLength(32);
		expect(events[0]).toEqual({ kind: "progress", message: "8" });
	});
});
