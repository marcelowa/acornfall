import { useMemo } from "react";
import { cn } from "cn";
import { renderMarkdown } from "./render-markdown";
import "highlight.js/styles/github-dark.css";
import "./markdown.css";

export interface MarkdownProps {
	children: string;
	className?: string | undefined;
}

export function Markdown({ children, className }: MarkdownProps) {
	const html = useMemo(() => renderMarkdown(children), [children]);

	// The HTML was sanitised by the renderer above; that is the whole point of this component.
	// The direction follows the text, per paragraph: Hebrew reads right, English left.
	return (
		<div
			dir="auto"
			className={cn("markdown", className)}
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
