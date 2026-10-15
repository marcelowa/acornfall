# 07 — Consolidation (run 4)

Date: 2026-10-15, over the release surface's path before step 09 builds it.

## What merged

**One byte formatter.** Three copies existed: `formatFileSize` in `lib/attachments.ts` (the
composer's chips), `formatSize` in `components/settings/update-section.tsx` (the update card), and
one more in the mocks. The release page needs it in the picker rows and the size line, so it is now
`formatBytes` in `lib/format.ts`, with the chip, the card and the mocks calling it. The test moved
to `test/format.test.ts` beside the other formatter cases; `test/attachments.test.ts` keeps the
refusals.

**One route for the two doors.** The bar's mark and the settings page's Releases row both open the
release page. Step 09 gives them one `showUpdate(tag?)` on the platform hook, so the two entrances
cannot drift apart.

## What stayed, and why

- **`update-section.tsx` is untouched** beyond the formatter import. Step 09 replaces the whole
  section — the card, the notes toggle, the pin field, the runs dialog — so merging inside it now
  would be work thrown away.
- **The mock compositions** (`ui/src/mocks/release*.tsx`) are deleted in step 09 by the chain's own
  rule; they stay as they are until then.
- **No new primitives.** The page composes `Measure`, `Stack`, `Text`, `Badge`, `Button`, `Toggle`,
  `ToggleGroup`, `Dialog`, `SettingsGroup` and the transcript's `Markdown` as they are. Inventing a
  `ReleaseRow` or a `StateLine` component now would fix a shape before the build tests it.
- **Nothing else in `components/` duplicates this surface**: the state blocks, the picker and the
  bar's mark have no near-copy elsewhere in the tree.

## Checks

`bun run typecheck`, `bun run lint` (184 files, 0 warnings), `bun test` (**109 pass**, one more than
before: the byte cases moved), `bun run build:storybook`, `bun run check:system`, and `make lint` at
the root: green.
