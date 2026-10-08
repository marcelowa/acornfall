# UI Need Summary — Acornfall Redesign

## User Request
Current UI is practical but doesn't look good. Deeply analyze it and significantly improve UI + UX: make it beautiful and usable.

## Product Goal
Turn Acornfall's new React client (`ui/`) from a correct wireframe into a premium, calm, trustworthy agent console — without breaking ADR-0016 (tokens-or-nothing) or the dumb-screens architecture.

## Target Users
Solo developer / power user running local agents: lives in the transcript, manages multiple conversations per workspace, inspects context/tools/sandbox, switches models/thinking/agents.

## Primary Scenarios
1. Read a running transcript, steer or queue a follow-up mid-turn.
2. Find and resume a conversation from a rail of dozens.
3. Understand "why did the model see that" (Inspector: context/agent/sandbox/run).
4. Configure workspace defaults, theme, sandbox; manage workspaces.

## Platform and Surface
Desktop-first web app (served by gateway on 127.0.0.1:7777), responsive down to phone (rail → drawer, composer wraps). Light + dark via `.dark` class swap.

## Desired Quality Level
- Deep mode (user said "deeply analyze").
- Production-ready direction, shipped in sequenced PRs: MVP re-skin first, polish second.

## Constraints
- Tech: React 19 + Vite + Tailwind v4 (`@theme inline`), shadcn canon, Storybook as design surface.
- Design system: ADR-0016 — three token layers, semantic-only classes, `check-system.ts` bans arbitrary values / palette / `--base-*` outside tokens.css / classes in screens. Every visual change must be a token or semantic mapping.
- Architecture: screens dumb (props in/callbacks out), `Stack/Split/Page/Grid/Measure` only; `WorkspaceView` + `usePlatform` applies logic.
- Accessibility: keyboard-first (splitter resizable, slash menu, dialogs), visible focus, reduced-motion.

## Decisions Confirmed With User
- Mode: Deep.
- Direction: "calibrated instrument" — precise, quiet, layered, trustworthy. No decorative gradients / glass / AI-slop.

## Open Questions
- Ship docked Inspector at ≥2xl, or keep overlay-only? (Spec recommends docked; needs confirmation.)
- Transcript body 14px → 16px? (Spec recommends yes.)
- Proceed to implementation PRs after spec approval, or prototype first?
