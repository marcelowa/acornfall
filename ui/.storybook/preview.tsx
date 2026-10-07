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
		// The layout is responsive, so the sizes it changes at are in the toolbar: 1024 (lg)
		// moves the rail behind the toggle, 1536 (2xl) gives the inspector its room. A story
		// pins one with `globals: { viewport: { value: … } }` — Storybook 10 removed both
		// `defaultViewport` and the old `viewports` list.
		viewport: {
			options: {
				phone: { name: "Phone (390)", styles: { width: "390px", height: "844px" } },
				tablet: { name: "Tablet (834)", styles: { width: "834px", height: "1112px" } },
				laptop: { name: "Laptop (1280)", styles: { width: "1280px", height: "800px" } },
				desktop: { name: "Desktop (1600)", styles: { width: "1600px", height: "900px" } },
				wide: { name: "Wide (1920)", styles: { width: "1920px", height: "1080px" } },
			},
		},
	},
};

export default preview;
