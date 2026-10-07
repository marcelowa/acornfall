import { withThemeByClassName } from "@storybook/addon-themes";
import type { Preview } from "@storybook/react-vite";
import "../src/styles/globals.css";

/**
 * Stories render with the app's own CSS — the tokens, the theme, the resets — so a story
 * cannot look right for a reason production does not have. The toolbar toggles `.dark` on the
 * same element the app toggles it on.
 */
const preview: Preview = {
	decorators: [
		withThemeByClassName({
			themes: { light: "", dark: "dark" },
			defaultTheme: "light",
		}),
	],
	parameters: {
		layout: "fullscreen",
	},
};

export default preview;
