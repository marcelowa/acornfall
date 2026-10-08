import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@fontsource-variable/inter";
import "@/styles/globals.css";

const root = document.getElementById("root");
if (root === null) {
	throw new Error("index.html has no #root");
}

createRoot(root).render(
	<StrictMode>
		<TooltipProvider>
			<App />
		</TooltipProvider>
	</StrictMode>,
);
