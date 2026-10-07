import { describe, expect, test } from "bun:test";
import { scanSources, type SourceFile } from "../scripts/check-system";

const scan = (...files: SourceFile[]) => scanSources(files);
const file = (path: string, text: string): SourceFile => ({ path, text });

describe("the design system scanner", () => {
	test("passes a component drawn from tokens", () => {
		const button = file(
			"src/components/ui/button.tsx",
			'<button className="rounded-md bg-primary p-4 text-sm text-primary-foreground" />',
		);
		expect(scan(button)).toEqual([]);
	});

	test("fails an arbitrary design value", () => {
		const violations = scan(
			file("src/components/ui/button.tsx", '<div className="p-[13px]" />'),
		);
		expect(violations).toHaveLength(1);
		expect(violations[0]?.rule).toBe("arbitrary design value");
	});

	test("allows a bracket that only references a token", () => {
		const split = file(
			"src/components/layout/split.tsx",
			'<div className="grid-cols-[var(--rail-width)_minmax(0,1fr)]" />',
		);
		expect(scan(split)).toEqual([]);
	});

	test("fails a class from Tailwind's palette", () => {
		const violations = scan(
			file("src/components/ui/button.tsx", '<div className="bg-blue-500" />'),
		);
		expect(violations).toHaveLength(1);
		expect(violations[0]?.rule).toBe("default palette colour");
	});

	test("fails a primitive read outside the token files", () => {
		const violations = scan(
			file("src/components/ui/button.tsx", 'const colour = "var(--base-brand-600)";'),
		);
		expect(violations).toHaveLength(1);
		expect(violations[0]?.rule).toBe("primitive read outside tokens.css");
	});

	test("lets the foundations pages read primitives to show them", () => {
		const palette = file(
			"src/foundations/palette.stories.tsx",
			'<div style={{ backgroundColor: "var(--base-brand-500)" }} />',
		);
		expect(scan(palette)).toEqual([]);
	});

	test("lets a line carry an exception with its reason", () => {
		const overview = file(
			"src/foundations/overview.stories.tsx",
			'// check-system:ignore -- the page shows them\nconst rejected = ["text-[11px]"];',
		);
		expect(scan(overview)).toEqual([]);
	});

	test("does not let an exception without a reason pass", () => {
		const sloppy = file(
			"src/components/ui/button.tsx",
			'// check-system:ignore\nconst bad = "text-[11px]";',
		);
		expect(scan(sloppy)).toHaveLength(1);
	});

	test("fails an import from the cn package", () => {
		const violations = scan(file("src/components/ui/button.tsx", 'import { cn } from "cn";'));
		expect(violations).toHaveLength(1);
		expect(violations[0]?.rule).toBe("the cn package is not this project's");
	});

	test("fails a class on a screen", () => {
		const violations = scan(file("src/screens/shell.tsx", '<div className="p-4" />'));
		expect(violations).toHaveLength(1);
		expect(violations[0]?.rule).toBe("a screen carries a class");
	});

	test("lets a story style its placeholders", () => {
		expect(scan(file("src/screens/shell.stories.tsx", '<div className="p-4" />'))).toEqual([]);
	});
});
