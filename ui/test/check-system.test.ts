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

	test("fails a class on a screen", () => {
		const violations = scan(file("src/screens/shell.tsx", '<div className="p-4" />'));
		expect(violations).toHaveLength(1);
		expect(violations[0]?.rule).toBe("a screen carries a class");
	});

	test("lets a story style its placeholders", () => {
		expect(scan(file("src/screens/shell.stories.tsx", '<div className="p-4" />'))).toEqual([]);
	});
});
