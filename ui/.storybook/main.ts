import type { StorybookConfig } from "@storybook/react-vite";

/**
 * Storybook is the design surface, not a demo beside it: the primitives, the typography, the
 * components, and the screens are all reviewed here, in both themes, before the app wires any
 * logic to them.
 */
const config: StorybookConfig = {
	stories: ["../src/**/*.stories.@(ts|tsx)"],
	addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-themes"],
	framework: { name: "@storybook/react-vite", options: {} },
	core: { disableTelemetry: true },
};

export default config;
