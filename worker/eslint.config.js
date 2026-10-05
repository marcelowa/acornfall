/**
 * The rules this project holds itself to, by name, so the standards document can point at
 * them. Type-aware on purpose: the ones that catch real bugs here — a promise nobody awaits,
 * a switch that stopped being exhaustive when a union grew — need types, and a linter that
 * cannot see them only finds formatting.
 *
 * Deliberately not `recommendedTypeChecked`: the `no-unsafe-*` family fires on every
 * `JSON.parse`, and validating a payload by checking its fields is what this code does on
 * purpose. The rules below are the ones we actually keep.
 */
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		files: ["src/**/*.ts", "test/**/*.ts"],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
		},
		plugins: { "@typescript-eslint": tseslint.plugin },
		rules: {
			// Promises: every one is awaited, returned, or explicitly ignored with `void`.
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/no-misused-promises": "error",
			"@typescript-eslint/await-thenable": "error",
			// A union that grows must break the switch that switches on it.
			"@typescript-eslint/switch-exhaustiveness-check": "error",
			// Types at the edges: `any` is not allowed; `unknown` plus a check is the way.
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
			"@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
			"@typescript-eslint/no-non-null-assertion": "off",
			"eqeqeq": ["error", "smart"],
			"prefer-const": "error",
			"no-var": "error",
		},
	},
);
