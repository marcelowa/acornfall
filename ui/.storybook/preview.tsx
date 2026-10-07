import { withThemeByClassName } from "@storybook/addon-themes";
import type { Preview } from "@storybook/react-vite";
import { TooltipProvider } from "@/components/ui/tooltip";
import "../src/styles/globals.css";

/**
 * Stories render with the app's own CSS — the tokens, the theme, the resets — so a story
 * cannot look right for a reason production does not have. The toolbar toggles `.dark` on the
 * same element the app toggles it on, and the provider is the app's own wiring for a control
 * that Radix requires one for.
 */
const preview: Preview = {
	decorators: [
		withThemeByClassName({
			themes: { light: "", dark: "dark" },
			defaultTheme: "light",
		}),
		(Story) => (
			<TooltipProvider>
				<Story />
			</TooltipProvider>
		),
	],
	parameters: {
		layout: "fullscreen",
	},
};

export default preview;
