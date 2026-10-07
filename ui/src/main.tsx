import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/typography/heading";
import { Text } from "@/components/typography/text";
import { Shell } from "@/screens/shell";
import "@/styles/globals.css";

/**
 * The development harness, not the app. The app's wiring is its own issue; this mounts the
 * dumb shell with placeholder slots so `bun run dev` and `bun run build` exercise the whole
 * chain, and the theme toggle — the only logic in the foundation — sits at the entry point,
 * where logic belongs.
 */
function Harness() {
	const [dark, setDark] = useState(false);

	useEffect(() => {
		document.documentElement.classList.toggle("dark", dark);
	}, [dark]);

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
		<Stack direction="horizontal" gap="sm" padding="md" className="border-t border-border">
			<Button size="sm">Send</Button>
			<Button variant="outline" size="sm" onClick={() => setDark((value) => !value)}>
				{dark ? "Light" : "Dark"}
			</Button>
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
