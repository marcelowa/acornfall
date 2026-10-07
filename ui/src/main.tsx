import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Heading } from "@/components/typography/heading";
import { Text } from "@/components/typography/text";
import { Shell } from "@/screens/shell";
import "@/styles/globals.css";

/**
 * The development harness, not the app. The app's wiring is its own issue; this mounts the
 * dumb shell with placeholder slots so `bun run dev` and `bun run build` exercise the whole
 * chain, and the theme — the state and the click handler — lives at the entry point, where
 * logic belongs.
 */
function Harness() {
	const [theme, setTheme] = useState<"light" | "dark">("light");

	useEffect(() => {
		document.documentElement.classList.toggle("dark", theme === "dark");
	}, [theme]);

	const rail = (
		<Stack gap="sm" padding="md" fill className="border-r border-border bg-card">
			<Text weight="semibold">Conversations</Text>
			<Text size="sm" tone="muted">
				The rail arrives with #11.
			</Text>
		</Stack>
	);

	const transcript = (
		<Stack gap="lg">
			<Heading level={1}>Acornfall</Heading>
			<Text tone="muted">
				The transcript arrives with #11. This harness proves the tokens, the layout
				primitives, and the build.
			</Text>
		</Stack>
	);

	const composer = (
		<Stack
			direction="horizontal"
			gap="sm"
			align="center"
			padding="md"
			className="border-t border-border"
		>
			<Button size="sm">Send</Button>
			<ThemeToggle
				theme={theme}
				onToggle={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
			/>
		</Stack>
	);

	return <Shell rail={rail} transcript={transcript} composer={composer} />;
}

const root = document.getElementById("root");
if (root === null) {
	throw new Error("index.html has no #root");
}

createRoot(root).render(
	<StrictMode>
		<Harness />
	</StrictMode>,
);
