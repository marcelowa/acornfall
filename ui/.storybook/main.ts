import type { StorybookConfig } from "@storybook/react-vite";

/**
 * Storybook binds every interface, so the catalogue is reachable from this machine's tailnet
 * name — but Storybook's own middleware and Vite each reject a Host they were not told about,
 * which turns a browser opening desktop:6006 into a 403. The tailnet is the boundary the
 * gateway already trusts (see the Makefile), so its names are allowed and nothing else is.
 */
const allowedHosts = ["desktop", ".ts.net"];

/**
 * Storybook is the design surface, not a demo beside it: the primitives, the typography, the
 * components, and the screens are all reviewed here, in both themes, before the app wires any
 * logic to them.
 */
const config: StorybookConfig = {
	stories: ["../src/**/*.stories.@(ts|tsx)"],
	addons: [
		"@storybook/addon-docs",
		"@storybook/addon-a11y",
		"@storybook/addon-themes",
		// The viewport toolbar and its decorator are core in Storybook 10, but not registered
		// by default; a story pins one with `globals: { viewport: { value: … } }`.
		"storybook/viewport",
	],
	framework: { name: "@storybook/react-vite", options: {} },
	core: { disableTelemetry: true, allowedHosts },
	async viteFinal(viteConfig) {
		viteConfig.server = { ...viteConfig.server, allowedHosts };
		return viteConfig;
	},
};

export default config;
