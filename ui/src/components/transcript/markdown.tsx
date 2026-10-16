import { useMemo } from "react";
import { cn } from "cn";
import { Chart } from "./chart";
import { renderMarkdown } from "./render-markdown";
import { MermaidDiagram } from "./mermaid-diagram";
import { splitBlocks } from "./markdown-blocks";
import { Spark } from "./spark";
import "highlight.js/styles/github-dark.css";
import "./markdown.css";

export interface MarkdownProps {
	children: string;
	className?: string | undefined;
	/** A reply that is still arriving. An open fence is text until it closes, so nothing is drawn
	 * from half a diagram, and a live reply is never a diagram plus a control it has not earned
	 * yet. */
	streaming?: boolean | undefined;
}

export function Markdown({ children, className, streaming = false }: MarkdownProps) {
	const segments = useMemo(
		() => (streaming ? [{ kind: "text" as const, text: children }] : splitBlocks(children)),
		[children, streaming],
	);

	// The HTML was sanitised by the renderer below; that is the whole point of this component.
	// The direction follows the text, per paragraph: Hebrew reads right, English left.
	return (
		<div dir="auto" className={cn("markdown", className)}>
			{segments.map((segment, index) =>
				segment.kind === "mermaid" ? (
					<MermaidDiagram key={index} source={segment.source} />
				) : segment.kind === "chart" ? (
					<Chart key={index} source={segment.source} />
				) : segment.kind === "spark" ? (
					<Spark key={index} source={segment.source} />
				) : (
					<MarkdownText key={index} text={segment.text} />
				),
			)}
		</div>
	);
}

/** One run of prose. The wrapper is invisible (`display: contents` in markdown.css) and only
 * exists because set HTML and React children cannot share an element. */
function MarkdownText({ text }: { text: string }) {
	const html = useMemo(() => renderMarkdown(text), [text]);
	return <div className="markdown-part" dangerouslySetInnerHTML={{ __html: html }} />;
}
