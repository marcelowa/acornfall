/**
 * `mayAddress` decides whether one conversation may address another, and everything it decides
 * with is a read: the policy, this conversation's own index, the target's record, and this
 * conversation's own owner.
 *
 * A read that failed used to be caught and turned into "no conversation X", so the tool told the
 * model something untrue about a conversation that exists. A failure to read is now a failure,
 * while a target that is genuinely absent is still simply absent — which is what the second test
 * here holds onto.
 */
import { describe, expect, test } from "bun:test";
import type { Context } from "@earendil-works/chord";
import type { Harness, Storage } from "@earendil-works/pi-durable";
import { mayAddress, type DelegationDeps } from "../src/delegation.ts";

const context = {} as Context;

/** Deps with only the reads `mayAddress` and its policy need, so a failure can be staged. */
function deps(conversation: (id: number) => Promise<unknown> = async () => undefined): DelegationDeps {
	return {
		harness: { snapshot: async () => undefined } as unknown as Harness,
		storage: {
			conversation,
			scanConversations: async () => ({ items: [], next: undefined }),
		} as unknown as Storage,
		catalog: () => ({ defaults: [], agents: [] }),
	};
}

describe("mayAddress", () => {
	test("a read that fails is a failure, not an absent conversation", async () => {
		// Only the target's read fails: a failure in this conversation's own reads would reject
		// for a different reason and the test would pass without the change under it.
		const broken = deps(async (id) => {
			if (id === 2) throw new Error("storage is gone");
			return undefined;
		});
		expect(mayAddress(broken, "1", "2", context)).rejects.toThrow("storage is gone");
	});

	test("a conversation that is genuinely absent is still absent", async () => {
		const verdict = await mayAddress(deps(), "1", "2", context);
		expect(verdict.allowed).toBe(false);
		expect(verdict.why).toBe("no conversation 2");
	});

	test("a conversation addressing itself is refused without any read", async () => {
		const verdict = await mayAddress(deps(), "7", "7", context);
		expect(verdict.allowed).toBe(false);
		expect(verdict.why).toBe("that is this conversation");
	});
});
