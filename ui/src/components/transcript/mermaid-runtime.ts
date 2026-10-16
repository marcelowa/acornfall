import type { Mermaid } from "mermaid";
import { guardSvg } from "@/lib/svg-guard";

/**
 * Mermaid, loaded the first time a reply has a diagram in it.
 *
 * The package is about 200 kB gzipped with the diagram type that goes with it, which is too much to
 * pay for prose. The dynamic import inside `drawDiagram` is what keeps that promise: a console that
 * never shows a diagram never downloads Mermaid.
 *
 * The palette is read from the console's own tokens at draw time rather than written down here, so
 * light and dark are the values `tokens.css` already decided, and a token change moves the diagrams
 * with it. Mermaid mixes shades of its own from these (pie slices, git graph lanes), which is why
 * they are handed over as plain colours rather than as the `color-mix()` expressions some semantic
 * tokens are written as.
 */

export type Theme = "light" | "dark";

let loading: Promise<Mermaid> | null = null;
let counter = 0;

function value(name: string): string {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

let swatch: CanvasRenderingContext2D | null = null;

/** A token, as a colour Mermaid can compute with.
 *
 * Mermaid mixes its own shades (pie slices, git lanes) and its colour maths understands hex and
 * rgb, not the oklch these tokens are written in: handed one, it throws "Unsupported color format"
 * and nothing draws. A one-pixel canvas is the browser's own answer to "what colour is this", and
 * it resolves `color-mix()` expressions too, so that is where the value goes. */
function colour(name: string, fallback: string): string {
	const token = value(name);
	if (token === "") return fallback;
	if (typeof CSS !== "undefined" && !CSS.supports("color", token)) return fallback;

	// A context handed something it cannot parse keeps the value it already had, so the sentinel is
	// there to make that visible rather than silent.
	swatch ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
	if (swatch === null) return fallback;
	swatch.fillStyle = "#ff00ff";
	swatch.fillStyle = token;
	swatch.fillRect(0, 0, 1, 1);
	const [red = 0, green = 0, blue = 0, alpha = 255] = swatch.getImageData(0, 0, 1, 1).data;
	return alpha === 255
		? `rgb(${red}, ${green}, ${blue})`
		: `rgba(${red}, ${green}, ${blue}, ${(alpha / 255).toFixed(2)})`;
}

/** The console's roles in Mermaid's names. Everything Mermaid would otherwise default to a grey is
 * mapped; the rest of its palette stays its own. The fallbacks are the light theme's values, for a
 * document that has not loaded the tokens at all. */
function variables(): Record<string, string> {
	return {
		background: colour("--background", "#faf8f5"),
		primaryColor: colour("--card", "#ffffff"),
		primaryTextColor: colour("--card-foreground", "#1c1917"),
		primaryBorderColor: colour("--border", "#e7e2da"),
		lineColor: colour("--muted-foreground", "#8a8078"),
		secondaryColor: colour("--muted", "#f2efea"),
		tertiaryColor: colour("--muted", "#f2efea"),
		textColor: colour("--foreground", "#1c1917"),
		mainBkg: colour("--card", "#ffffff"),
		nodeBorder: colour("--border", "#e7e2da"),
		clusterBkg: colour("--muted", "#f2efea"),
		clusterBorder: colour("--border", "#e7e2da"),
		edgeLabelBackground: colour("--background", "#faf8f5"),
		titleColor: colour("--foreground", "#1c1917"),
		fontFamily: value("--font-sans"),
		fontSize: value("--text-sm"),
		actorBkg: colour("--card", "#ffffff"),
		actorBorder: colour("--border", "#e7e2da"),
		actorTextColor: colour("--card-foreground", "#1c1917"),
		signalColor: colour("--muted-foreground", "#8a8078"),
		signalTextColor: colour("--foreground", "#1c1917"),
		noteBkgColor: colour("--muted", "#f2efea"),
		noteTextColor: colour("--foreground", "#1c1917"),
		noteBorderColor: colour("--border", "#e7e2da"),
		labelBoxBkgColor: colour("--card", "#ffffff"),
		labelBoxBorderColor: colour("--border", "#e7e2da"),
		labelTextColor: colour("--card-foreground", "#1c1917"),
		errorBkgColor: colour("--destructive", "#b4544a"),
		errorTextColor: colour("--background", "#faf8f5"),
	};
}

/** Mermaid's first line of complaint, which is the line that says what is wrong. */
function reason(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	const line = text.split("\n").find((candidate) => candidate.trim() !== "");
	return (line ?? "Mermaid refused the diagram").trim();
}

/** The source in, a drawing out. Throws with Mermaid's own words when it cannot be drawn. */
export async function drawDiagram(source: string, theme: Theme): Promise<SVGSVGElement> {
	loading ??= import("mermaid").then((module) => module.default);

	// The instance is global to the module and its variables come from the DOM, so this runs on
	// every draw rather than once: that is what makes a theme flip bring new colours.
	const mermaid = await loading;
	mermaid.initialize({
		startOnLoad: false,
		// The console's first layer of refusal: Mermaid drops script elements, event handlers and
		// `javascript:` links before anything here sees the drawing.
		securityLevel: "strict",
		// A broken diagram throws instead of painting Mermaid's own error box into the page: the
		// pane says what happened, in the console's voice.
		suppressErrorRendering: true,
		theme: "base",
		themeVariables: variables(),
	});

	counter += 1;
	let markup: string;
	try {
		({ svg: markup } = await mermaid.render(`acornfall-diagram-${theme}-${counter}`, source));
	} catch (error) {
		throw new Error(reason(error));
	}

	// The second layer, because Mermaid's own sanitiser leaves an image where a diagram asked for
	// one, and a browser fetches an image.
	const drawing = guardSvg(markup);
	if (drawing === null) throw new Error("Mermaid did not return a drawing");
	return drawing;
}
