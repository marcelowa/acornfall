/**
 * The durable machinery behind background subagents, following the shape pi-durable
 * documents in test/examples/23-subagent-background.ts.
 *
 * Two task kinds:
 *
 * - **Anchor**: a background task that finishes immediately. It exists only to own a
 *   subagent conversation. Ownership decides what an abort reaches, and "background"
 *   is the boundary that stops a parent's Esc there, so a subagent outlives the turn
 *   that started it.
 * - **Reporter**: delivers one message to a subagent and reports its answer back to
 *   the parent as a follow-up input. Two phases, each checkpointed, so a restart
 *   resumes mid-flight, and two request ids so a restart cannot deliver the same
 *   message or the same report twice.
 *
 * Why a reporter task rather than a callback: this is the piece that has to survive a
 * crash. "Deliver the answer to the parent" is a durable intention with an
 * idempotency key, not a promise that resolves while the process happens to be alive.
 */
import type { Context } from "@earendil-works/chord";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	AssistantEntry,
	type ConversationId,
	defineDoc,
	defineTask,
	type EntryId,
	type TaskId,
} from "@earendil-works/pi-durable";
import { type DelegationDeps, policyFor } from "./delegation.ts";

export type Subagent = {
	conversationId: ConversationId;
	/** Answers already reported: several messages can end in one answer, reported once. */
	reported: EntryId[];
	/** A peer is ownerless, so it appears in the rail and outlives its creator. */
	peer: boolean;
};

export type DelegationState = {
	/** Subagents by the name their parent gave them, which is how the model addresses them. */
	agents: Record<string, Subagent>;
	/** Live reporters, so a spawn or send knows what it already started. */
	reporters: Record<string, TaskId>;
	/**
	 * How many times a subagent's answer has woken this conversation. The budget that
	 * stops a chain of agents from talking to each other indefinitely.
	 */
	wakes: number;
};

/** Who sent each user-visible entry: the conversations that talked to this one. */
export type MessageSender = {
	/** The conversation that sent it. */
	conversationId: string;
	/** The name its sender gave it, for a subagent or peer. */
	name?: string;
	kind: "task" | "send" | "report";
};

export type MessagesState = {
	/** Keyed by entry id, so the UI never has to guess from the text. */
	senders: Record<string, MessageSender>;
};

/**
 * A message between conversations is admitted as a `pi.user` entry, because that is
 * what starts a run — there is no other way to wake a conversation. This document is
 * the missing half: which of those entries were not the user's.
 */
export const MessagesDoc = defineDoc<MessagesState>({
	kind: "acornfall.messages",
	version: 1,
	scope: "conversation",
	history: "latest",
	// A fork inherits who said what: the messages are inherited with it.
	fork: "initial",
	initial: () => ({ senders: {} }),
});

export const DelegationDoc = defineDoc<DelegationState>({
	kind: "acornfall.delegation",
	version: 1,
	scope: "conversation",
	history: "latest",
	// A fork starts without its parent's subagents; it is a different conversation.
	fork: "initial",
	initial: () => ({ agents: {}, reporters: {}, wakes: 0 }),
});

export const Anchor = defineTask<null, { phase: "done" }, null>({
	name: "acornfall.subagent-anchor",
	version: 1,
	initial: () => ({ phase: "done" }),
	phases: {
		done: (_anchor, runtime, context) =>
			runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context),
	},
	abort: (_anchor, runtime, context) =>
		runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

export type ReporterInput = {
	name: string;
	conversationId: ConversationId;
	message: string;
	/** Steering reaches a busy conversation at its next step; a follow-up waits for its answer. */
	followUp: boolean;
	/**
	 * Whether the answer comes back to this conversation at all. A subagent reports;
	 * a peer does not, because a peer is a normal conversation the user also reads.
	 */
	report: boolean;
};

export type ReporterState = { phase: "deliver" } | { phase: "report"; report?: string };

function textOf(message: AssistantMessage | undefined): string {
	return (message?.content ?? []).flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

export function reporterTask(deps: DelegationDeps) {
	return defineTask<ReporterInput, ReporterState, null>({
		name: "acornfall.subagent-reporter",
		version: 1,
		initial: () => ({ phase: "deliver" }),
		phases: {
			deliver: async (reporter, runtime, context) => {
				const { name, conversationId, message, followUp } = reporter.input;
				const target = String(conversationId);
				const sender = String(runtime.conversationId);
				const subagent = await runtime.conversation(conversationId, context);
				const request = {
					type: "input",
					// The model needs to know this is another conversation talking, not its
					// user. The interface learns the same thing from the document below.
					content: `[from conversation ${sender}] ${message}`,
					whenBusy: followUp ? ("followUp" as const) : ("steer" as const),
				} as const;
				const submission = await subagent!.submit(
					{ ...request, requestId: `acornfall:subagent:${reporter.id}` },
					context,
				);
				const settled = await submission.wait(context);
				// `entry` is the admitted input, so provenance is recorded against the exact
				// entry rather than inferred later from its text.
				const placed = "entry" in settled && settled.entry !== undefined ? settled.entry : undefined;
				if (placed !== undefined) {
					await runtime.commit(async (tx) => {
						const messages = await tx.doc(MessagesDoc, conversationId);
						messages.senders[String(placed)] = {
							conversationId: sender,
							name,
							kind: followUp ? "send" : "task",
						};
						return undefined;
					}, context);
					// Writing our document does not advance durable's view, because the view
					// mounts only its own documents: without this the interface would never
					// learn that the entry it just rendered was not the user's.
					deps.notify?.(target);
				}

				// One commit decides the report and records the answer as delivered, so a
				// restart mid-flight cannot report the same answer twice.
				return runtime.commit(async (tx) => {
					// `exactOptionalPropertyTypes` means an absent report and an undefined
					// one are different shapes, so build the checkpoint accordingly. The
					// return type is explicit, or `phase` widens to string.
					const next = (report?: string): { status: "running"; checkpoint: ReporterState } =>
						report === undefined
							? { status: "running", checkpoint: { phase: "report" } }
							: { status: "running", checkpoint: { phase: "report", report } };
					if (settled.status === "unanswered") {
						// Aborted means it was stopped or withdrawn: nothing worth waking anyone for.
						return next(
							settled.reason === "aborted"
								? undefined
								: `[subagent ${name} could not answer: ${settled.reason}]`,
						);
					}
					if (settled.type !== "input") return next();
					const state = await tx.doc(DelegationDoc, runtime.conversationId);
					const agent = state.agents[name];
					if (agent === undefined) return next();
					if (agent.reported.includes(settled.answer)) return next();
					agent.reported.push(settled.answer);
					const answer = (await tx.entry(AssistantEntry, settled.answer))?.model?.[0] as
						| AssistantMessage
						| undefined;
					return next(`[from subagent ${name}] ${textOf(answer)}`);
				}, context);
			},
			report: async (reporter, runtime, context) => {
				const report = reporter.state.checkpoint.report;
				if (report !== undefined && reporter.input.report) {
					// Read the budget, then spend it. Two reporters for one conversation
					// could in principle both read before either writes, which costs at
					// most an extra wake-up: the budget is a guard, not an invariant, and
					// delivery itself is idempotent through the request id below.
					const policy = await policyFor(deps, String(runtime.conversationId), context);
					const state = await deps.harness.snapshot(DelegationDoc, runtime.conversationId, context);
					const spent = (state?.wakes ?? 0) >= policy.delegation.maxWakes;
					const text = spent
						? `[subagent ${reporter.input.name} finished, but this conversation has used its ${policy.delegation.maxWakes} wake-ups. Read conversation ${String(reporter.input.conversationId)} for the answer.]`
						: report;

					if (!spent) {
						await runtime.commit(async (tx) => {
							const current = await tx.doc(DelegationDoc, runtime.conversationId);
							current.wakes += 1;
							return undefined;
						}, context);
					}

					// A follow-up starts a turn when the parent is idle and waits for its
					// current answer otherwise: the parent continues on its own, without a
					// human in the loop, which is the point of a background subagent.
					const parent = await runtime.conversation(runtime.conversationId, context);
					const submission = await parent!.submit(
						{
							type: "input",
							content: text,
							whenBusy: "followUp",
							requestId: `acornfall:subagent-report:${reporter.id}`,
						},
						context,
					);
					// Wait for it to be placed so the report can be attributed too: an answer
					// arriving in a parent's transcript looks exactly like the user asking.
					const settled = await submission.wait(context);
					const placed = "entry" in settled && settled.entry !== undefined ? settled.entry : undefined;
					if (placed !== undefined) {
						await runtime.commit(async (tx) => {
							const messages = await tx.doc(MessagesDoc, runtime.conversationId);
							messages.senders[String(placed)] = {
								conversationId: String(reporter.input.conversationId),
								name: reporter.input.name,
								kind: "report",
							};
							return undefined;
						}, context);
						deps.notify?.(String(runtime.conversationId));
					}
				}
				await runtime.commit(
					() => ({ status: "terminal", outcome: { status: "completed", result: null } }),
					context,
				);
			},
		},
		abort: (_reporter, runtime, context) =>
			runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
	});
}
