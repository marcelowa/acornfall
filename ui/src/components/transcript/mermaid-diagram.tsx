import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Text } from "@/components/typography/text";
// The refusal shows the source as the reply would have shown it, and those code-block styles are
// the markdown renderer's.
import "./markdown.css";
import "./mermaid.css";
import { drawDiagram, type Theme } from "./mermaid-runtime";

/**
 * One diagram from a fence, drawn once the reply has settled.
 *
 * Nothing here draws while the text is still arriving: `Markdown` keeps an open fence as text, and
 * an entry that is still live is a code block from the first delta to the last. The reader gets the
 * drawing at the same moment they get the pane's controls, which is one rule instead of two.
 */
export interface MermaidDiagramProps {
	/** The fence's body, exactly as the model wrote it. */
	source: string;
}

/** Past this the source is shown instead of drawn. Mermaid has no way to cancel a render, so the
 * size of the source is the only guard there is against a diagram that holds the pane. */
const MAX_SOURCE = 8 * 1024;

/** How long a render may hold the pane before the source is shown instead. Mermaid cannot be
 * cancelled, so a source small enough to try and still slow to draw is the case the size guard
 * cannot catch: the reader waits, then gets the thing they can at least read. */
const DRAW_TIMEOUT_MS = 10_000;

type Drawing = { state: "drawing" } | { state: "drawn" } | { state: "refused"; reason: string };

function currentTheme(): Theme {
	return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** The console flips `.dark` on the root element, and that is the whole theme protocol: watching it
 * is cheaper than threading the theme down to a leaf of the transcript. */
function subscribeToTheme(onChange: () => void): () => void {
	const watcher = new MutationObserver(onChange);
	watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
	return () => watcher.disconnect();
}

export function MermaidDiagram({ source }: MermaidDiagramProps) {
	const host = useRef<HTMLDivElement>(null);
	const theme = useSyncExternalStore(subscribeToTheme, currentTheme);
	const [drawing, setDrawing] = useState<Drawing>({ state: "drawing" });

	useEffect(() => {
		if (source.length > MAX_SOURCE) {
			setDrawing({
				state: "refused",
				reason: `the source is longer than ${MAX_SOURCE / 1024} kB`,
			});
			return;
		}

		let current = true;
		setDrawing({ state: "drawing" });
		// A render that has not answered by now is one the pane will not wait for: the source is what
		// a person can still use, and a late answer is ignored like one for another source.
		const timer = setTimeout(() => {
			if (!current) return;
			current = false;
			setDrawing({
				state: "refused",
				reason: `the drawing took longer than ${DRAW_TIMEOUT_MS / 1000} seconds`,
			});
		}, DRAW_TIMEOUT_MS);
		void drawDiagram(source, theme)
			.then((drawing) => {
				clearTimeout(timer);
				if (!current) return;
				host.current?.replaceChildren(drawing);
				setDrawing({ state: "drawn" });
			})
			.catch((error: unknown) => {
				clearTimeout(timer);
				if (!current) return;
				setDrawing({
					state: "refused",
					reason: error instanceof Error ? error.message : String(error),
				});
			});

		// A delta can replace the source under a render that is already running; its result belongs
		// to the source it was asked about.
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [source, theme]);

	return (
		<div className="mermaid-block" data-state={drawing.state}>
			{drawing.state === "refused" ? (
				<>
					<div className="code-block">
						<span className="code-lang">mermaid</span>
						<pre>
							<code>{source}</code>
						</pre>
					</div>
					<Text as="p" size="sm" tone="muted" className="mermaid-note">
						Diagram not drawn: {drawing.reason}
					</Text>
				</>
			) : null}
			{drawing.state === "drawing" ? (
				<Text as="p" size="sm" tone="muted" className="mermaid-note">
					Drawing the diagram…
				</Text>
			) : null}
			<div ref={host} className="mermaid-drawing" />
		</div>
	);
}
