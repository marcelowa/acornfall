/**
 * Declarative guards on tool calls.
 *
 * A guard can only deny, and it resolves per conversation through the same overlay as the
 * agent, so a rule added globally holds in a workspace, and a workspace's rule holds for
 * everything running there.
 *
 * This is the conservative half of hooks on purpose. durable's hooks are code registered
 * in this process, so a workspace hook file would execute workspace-provided code inside
 * the worker; that is a trust decision, not a config field, and it comes later. A guard
 * expressed in configuration can only block a call and say why, which covers the two
 * things that matter for an assistant with a shell: do not run this command, and do not
 * write outside the workspace.
 */
import type { Context } from "@earendil-works/chord";
import { AgentDoc, defineExtension, hook, ToolTask } from "@earendil-works/pi-durable";
import { resolveAgent, type Guard } from "./config.ts";
import { definitionOf, type DelegationDeps } from "./delegation.ts";

export interface GuardDeps extends DelegationDeps {
	/** The workspace folder, used when a conversation has no cwd of its own. */
	workspaceRoot: string;
}

/** Compiled once per pattern: a guard runs on every tool call. */
const compiled = new Map<string, RegExp>();

/** Exported for its tests: these two are the whole rule, and a rule is worth pinning. */
export function matches(guard: Guard, call: { name: string; arguments: Record<string, unknown> }, cwd: string): boolean {
	if (guard.tool !== "*" && guard.tool !== call.name) return false;
	const value = call.arguments[guard.arg];
	if (typeof value !== "string" || value === "") return false;

	if (guard.pattern !== undefined) {
		let expression = compiled.get(guard.pattern);
		if (expression === undefined) {
			expression = new RegExp(guard.pattern);
			compiled.set(guard.pattern, expression);
		}
		if (expression.test(value)) return true;
	}

	if (guard.outside === true) {
		const absolute = resolvePath(cwd, value);
		const root = cwd.endsWith("/") ? cwd : `${cwd}/`;
		// A path outside the workspace, or exactly at it, which would let a write replace
		// the folder itself.
		if (absolute === cwd || !absolute.startsWith(root)) return true;
	}
	return false;
}

/** Resolved without node:path so a `..` in the middle is handled the same way a shell does. */
export function resolvePath(cwd: string, value: string): string {
	const base = value.startsWith("/") ? [] : cwd.split("/").filter((part) => part !== "");
	const parts = value.split("/");
	for (const part of parts) {
		if (part === "" || part === ".") continue;
		if (part === "..") base.pop();
		else base.push(part);
	}
	return `/${base.join("/")}`;
}

export function guardsExtension(deps: GuardDeps) {
	return defineExtension({
		name: "acornfall-guards",
		hooks: [
			hook(ToolTask, {
				beforeTool: async (call, api, context: Context) => {
					const conversationId = String(api.conversationId);
					const resolved = resolveAgent(deps.catalog(), await definitionOf(deps, conversationId, context));
					if (resolved.guards.length === 0) return undefined;

					// The conversation's own directory, so a guard follows a conversation that
					// works somewhere other than the workspace root.
					const agent = await api.snapshot(AgentDoc, api.conversationId, context);
					const cwd = agent?.cwd ?? deps.workspaceRoot;

					for (const guard of resolved.guards) {
						if (!matches(guard, call, cwd)) continue;
						return { block: `Blocked by a rule: ${guard.reason}` };
					}
					return undefined;
				},
			}),
		],
	});
}
