# ADR 0016 — The interface's design system: tokens or nothing, and screens without classes

Status: accepted, in progress
Date: 2026-10-07

## Context

The interface is being rebuilt on what the platform already serves ([#10](https://github.com/marcelowa/acornfall/issues/10)), and the rebuild starts with the system the screens are drawn from ([#27](https://github.com/marcelowa/acornfall/issues/27)). The foundation comes from the metricside client: tokens as plain variables, Tailwind reading them through `@theme inline`, light and dark as a variable swap behind `.dark`, shadcn's semantic names on top. The pattern is good. What it lacks is teeth.

In metricside the pattern is a convention, and it has already drifted: the button is typed as `text-[11px]`, `px-2.5`, and `text-white` while the token file sits next to it, and nothing objects. Tailwind does not fail on a class it does not know; it drops it, and the UI ships mildly wrong. The design system is also a showcase page — a screen someone has to keep honest — and the screens themselves mix styling, fetching, and rendering, so a state can only be reviewed by running the product.

The client in this repository is the opposite extreme: no build step, plain ES modules served from the binary. It is a fine way to experience the system; it cannot carry a component canon, and it cannot render a state that has no data.

## Decision

**Three layers of tokens, one direction, and a Tailwind that knows nothing else.** Primitives (`--base-*`) are raw values and theme-independent — a ramp means the same thing in light and dark; the semantic layer (`--background`, `--primary`, …) is what a theme swaps; component tokens are the escape hatch, and even the escape hatch is a token. `globals.css` starts every namespace with `initial`, so Tailwind's defaults are unregistered: `p-13`, `bg-blue-500`, and `text-lg` produce no CSS at all. The one thing the theme cannot stop, an arbitrary value like `p-[13px]`, is a checks failure.

**Only components style.** A screen carries zero classes: it composes components and the layout primitives (`Stack`, `Split`, `Page`, `Grid`) and decides nothing about appearance. A screen that needs a style it cannot compose is a missing component, not a screen problem.

**Screens start dumb, and the app applies the logic.** A screen is a pure composition of props to elements — state in, callbacks out, no fetch, no SSE, no protocol types. The container that reads the platform and wires the callbacks is the app's, and it is the only part that needs a running gateway to review.

**Storybook is the whole design surface.** Primitives, typography, components, then screens with every state they can be in, in light and in dark. There is no showcase page: the catalogue is the product.

**Enforcement is mechanical.** `ui/scripts/check-system.ts` scans the sources for arbitrary values, Tailwind's palette, primitive reads outside the token file, and a class on a screen; then it compiles a candidate list with Tailwind itself and asserts that token classes resolve and default-scale classes do not. `make lint` runs it, and `ui/test/check-system.test.ts` keeps the scanner catching what it caught.

**The interface becomes a build.** Vite, React, TypeScript 7 under the strictest settings, and shadcn's canon at its current version. The built bundle is meant to be embedded in the gateway binary; until that change lands, `gateway/web` still serves the old client and the interface is built and catalogued beside it.

## Alternatives

- **Keep it a convention, as metricside did.** The move that fails quietly is the one people make. A convention with no check is a preference, and the evidence above is what a preference looks like after a year.
- **CSS Modules, vanilla-extract, or CSS-in-JS.** The system here is the token mapping, not the tool; the shadcn canon and the Tailwind plugin ecosystem are the leverage, and nothing about the token layers depends on a build-time CSS tool. Rejected as a rewrite with no feature behind it.
- **Keep the client no-build and skip the component canon.** It would mean hand-writing every primitive and a bespoke story runner, and the states would still need a place to live. The user's decision is React; the no-build property was a way to experience the system, not a constraint on it.
- **Keep the showcase page instead of Storybook.** A showcase is one more screen to keep honest and it renders one state of everything. Storybook gets the states, the themes, and the accessibility pass without an app.

## Consequences

- A class that does nothing is now expensive to write: it either fails the scan or resolves to no CSS and is caught by the probe. The cost is that the token list has to grow deliberately — a new size is a token change, not a class.
- Screens need layout primitives to express arrangement. When one is missing, the fix is a primitive, and that is the intended pressure: it is how the vocabulary of the interface stays small.
- Stories are maintenance. A state that is not storied is not reviewed, which is the point, and it is also real work in every interface issue.
- The bundle adds a build to a repository that had none for the client. `make deps` installs its toolchain, `make lint` checks it, `make test` builds it, and Storybook stays a development tool.
- The interfaces of the two clients diverge while both exist: `gateway/web` is the old client with its browser checks (`make ui`), `ui/` is the new one with Storybook. The old one is the reference for behaviour, not the design.
