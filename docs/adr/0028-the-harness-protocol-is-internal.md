# ADR 0028 — The harness protocol is internal, until a second harness exists

Status: accepted, 2026-10-22
Date: 2026-10-22

## Context

The protocol between the head and the mind (`worker/src/protocol.ts` ↔
`gateway/internal/protocol/protocol.go`) is described in ADR 0002 and `docs/features.md` as "the
seam a second harness implements". That phrasing promises more than the code does: there is no
version negotiation, no conformance suite, no compatibility promise, and both sides are changed in
one commit on purpose (standards, S6).

One harness implements it today. Asked on 2026-10-22 whether to freeze it as a supported surface,
the answer was no — keep it internal until the product is stable and mature enough to try others.

## Decision

1. **The protocol is an internal seam.** The two sides change together; a field added on one side
   and not the other is a bug in that commit, not a compatibility break.
2. **Nothing is added for the sake of outsiders**: no version field, no negotiation, no capability
   advertisement beyond what the two halves need today.
3. **The trigger to revisit is the first real second implementer** — someone outside asking to write
   a harness, or a second one shipping. That is the moment to freeze the shape and document it;
   before that, a frozen protocol is work for a consumer that does not exist.
4. **The docs say what it is.** Where the protocol is described as a seam, it is also described as
   internal today, so nobody builds against a promise nobody made.

## Alternatives

- **Freeze and document it now.** Versioning, a conformance suite, compatibility rules, and a
  migration path — for one implementer. The cost is paid immediately and the benefit is optional.
- **Declare a plugin API** (a package a third party installs). A much larger promise: the worker's
  environment seam, its tool registration, its provider credentials, and a support story.
- **Remove the seam and inline the harness.** Cheapest today, and it gives up the one property that
  makes the platform outlive a particular agent. Rejected: the seam costs little while it is internal.

## Consequences

- The head stays stable while the mind changes weekly, at no compatibility cost.
- A fork can implement the protocol by reading two files; that is a reasonable thing to do without a
  promise, and it is the path a serious second harness will take first.
- The first outside implementer will cost a real conversation about what "supported" means. That is
  the right time to have it.
