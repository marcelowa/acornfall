/**
 * The design system's rules, checked where a build cannot. Tailwind silently drops a class it
 * does not know, so `bg-blue-500` is not an error, it is a missing style — nobody notices
 * until something ships grey. Two checks, both of them mechanical:
 *
 *   - the source scan: arbitrary values (`p-[13px]`), Tailwind's default palette
 *     (`text-white`), a `--base-*` read outside tokens.css, and a class in `src/screens`.
 *   - the theme probe: compile a candidate list with Tailwind itself and assert that token
 *     classes resolve and default-scale classes do not. The theme is the enforcement
 *     mechanism; this is the check that the mechanism is still armed.
 *
 * `make lint` runs this. `ui/test/check-system.test.ts` covers the scanner, because a rule
 * that stops catching things should fail a test rather than pass a review.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

export interface SourceFile {
	/** Path relative to `ui/`, so a failure names the file the way a person would. */
	path: string;
	text: string;
}

export interface Violation {
	path: string;
	line: number;
	rule: string;
	text: string;
}

/** `p-[13px]`, `w-[280px]`, `bg-[#fff]`, `text-[oklch(...)]` — a design value in a bracket. A
 * bracket that only references a token (`grid-cols-[var(--rail-width)_minmax(0,1fr)]`) is a
 * token reference and passes. */
const arbitraryValue =
	/\[[^\]\n]*?(?:\d(?:px|rem|em|%|vw|vh|dvh|svh|ch)\b|#[0-9a-fA-F]{3,8}\b|(?:rgb|hsl|oklch|oklab|color-mix)\([^)\]]*\))/;

/** Tailwind's default palette by name: `bg-blue-500`, `text-white`, `border-red-300`. None of
 * them resolve here, so finding one means a class that does nothing. */
const paletteColour =
	/\b(?:bg|text|border|ring|fill|stroke|divide|outline|from|via|to|decoration|placeholder|caret|accent|shadow)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?)(?:\/\d+)?\b/;

/** A primitive read from application code. The direction is one way: primitives feed the
 * semantic layer in tokens.css, and everything else reads the semantic name. */
const baseToken = /--base-/;

export function scanSources(files: SourceFile[]): Violation[] {
	const violations: Violation[] = [];

	for (const file of files) {
		const isScreen =
			file.path.startsWith("src/screens/") && !/\.(stories|test)\./.test(file.path);

		file.text.split("\n").forEach((line, index) => {
			const trimmed = line.trim();
			// Prose in a comment explains the rule and names the values it forbids; scanning it
			// would make the rule impossible to write down.
			if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;

			const at = { path: file.path, line: index + 1 };
			if (arbitraryValue.test(line)) {
				violations.push({ ...at, rule: "arbitrary design value", text: trimmed });
			}
			if (paletteColour.test(line)) {
				violations.push({ ...at, rule: "default palette colour", text: trimmed });
			}
			if (baseToken.test(line)) {
				violations.push({
					...at,
					rule: "primitive read outside tokens.css",
					text: trimmed,
				});
			}
			if (isScreen && /\bclassName\b/.test(line)) {
				violations.push({ ...at, rule: "a screen carries a class", text: trimmed });
			}
		});
	}

	return violations;
}

/** Classes that must resolve: every namespace the components rely on, one representative each. */
const tokenClasses = [
	"p-4",
	"p-1.5",
	"gap-2",
	"size-4",
	"bg-background",
	"bg-primary",
	"text-foreground",
	"text-primary-foreground",
	"border-border",
	"bg-success-subtle",
	"rounded-md",
	"rounded-full",
	"shadow-xs",
	"font-sans",
	"font-medium",
	"max-w-page",
	"text-2xs",
	"text-3xl",
	"ease-out",
];

/** Classes that must not: off-scale steps, the default palette, and the default type scale. */
const defaultClasses = [
	"p-13",
	"gap-13",
	"m-13",
	"bg-blue-500",
	"text-white",
	"bg-neutral-100",
	"border-red-300",
	"text-4xl",
	"rounded-3xl",
	"shadow-2xl",
	"font-thin",
	"max-w-4xl",
];

export function checkTheme(): Violation[] {
	const probe = join(root, ".check-probe.css");
	const output = join(root, ".check-probe.out.css");
	const cli = join(root, "node_modules", ".bin", "tailwindcss");
	const css = `@import "./src/styles/globals.css";\n@source inline("${[...tokenClasses, ...defaultClasses].join(" ")}");\n`;

	writeFileSync(probe, css);
	try {
		execFileSync(cli, ["-i", probe, "-o", output], { cwd: root, stdio: "pipe" });
		// Selector escaping is irrelevant to a substring check, and removing it makes
		// `p-1.5` and `.p-1\.5` the same string.
		const compiled = readFileSync(output, "utf8").replace(/\\/g, "");
		const violations: Violation[] = [];

		for (const name of tokenClasses) {
			if (!compiled.includes(`.${name}`)) {
				violations.push({
					path: "src/styles/globals.css",
					line: 1,
					rule: "token class produced no CSS",
					text: name,
				});
			}
		}
		for (const name of defaultClasses) {
			if (compiled.includes(`.${name}`)) {
				violations.push({
					path: "src/styles/globals.css",
					line: 1,
					rule: "default class produced CSS",
					text: name,
				});
			}
		}

		return violations;
	} finally {
		rmSync(probe, { force: true });
		rmSync(output, { force: true });
	}
}

export function collectSources(): SourceFile[] {
	const src = join(root, "src");
	return readdirSync(src, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
		.map((entry) => {
			const path = join(entry.parentPath, entry.name);
			return { path: relative(root, path), text: readFileSync(path, "utf8") };
		});
}

export function runChecks(): Violation[] {
	return [...scanSources(collectSources()), ...checkTheme()];
}

if (import.meta.main) {
	const violations = runChecks();
	if (violations.length > 0) {
		const lines = violations.map(
			(violation) =>
				`${violation.path}:${violation.line}  ${violation.rule}\n    ${violation.text}`,
		);
		console.error(`design system:\n  - ${lines.join("\n  - ")}`);
		process.exit(1);
	}
	console.log("design system: tokens resolve, defaults do not, screens carry no classes");
}
