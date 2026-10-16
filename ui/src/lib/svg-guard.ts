/**
 * What Mermaid draws, looked over before it enters the page.
 *
 * Mermaid's own `securityLevel: "strict"` has already run by the time an SVG gets here: it drops
 * script elements, event handlers and `javascript:` links. This is the second look, for two
 * reasons. It leaves an `<img>` where a diagram asked for one, and a browser fetches an image —
 * the same exfiltration channel the console refuses everywhere else. And a diagram is the one
 * piece of markup in the transcript that does not pass through DOMPurify.
 *
 * DOMPurify cannot do this job, which is why there is a walk here instead: it empties
 * `<foreignObject>`, and every node label in a flowchart lives inside one, so the diagram would
 * arrive as a set of empty boxes. A walk says exactly what is refused, which is what a
 * hand-written filter in a security path has to be able to do.
 */

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Elements that fetch, submit, or run. `foreignObject` is not here on purpose: it is what holds
 * a node label, and its children are walked like any other. */
const FORBIDDEN = new Set([
	"script",
	"img",
	"image",
	"iframe",
	"frame",
	"frameset",
	"object",
	"embed",
	"applet",
	"form",
	"input",
	"button",
	"select",
	"textarea",
	"link",
	"meta",
	"base",
	"audio",
	"video",
	"source",
	"track",
]);

/** `url(...)` that does not point inside the drawing is a fetch, so it becomes `none`. A
 * `url(#clipPath-4)` is Mermaid's own clipping and stays. */
const FETCHING_URL = /url\(\s*(['"]?)(?!#)[^)]*\)/gi;

/** An `@import` in a `<style>` inside the SVG is another fetch. */
const IMPORT = /@import[^;]*;/gi;

function cleanCss(value: string): string {
	return value.replace(IMPORT, "").replace(FETCHING_URL, "none");
}

function cleanElement(element: Element): void {
	if (FORBIDDEN.has(element.tagName.toLowerCase())) {
		element.remove();
		return;
	}

	if (element.tagName.toLowerCase() === "style") {
		element.textContent = cleanCss(element.textContent ?? "");
	}

	for (const attribute of [...element.attributes]) {
		const name = attribute.name.toLowerCase();
		if (name.startsWith("on")) {
			element.removeAttribute(attribute.name);
			continue;
		}
		if (name === "href" || name === "xlink:href") {
			// Only a link inside the drawing. A `javascript:` URL never gets this far with Mermaid
			// strict, and this is the layer that does not have to trust that.
			if (!attribute.value.startsWith("#")) element.removeAttribute(attribute.name);
			continue;
		}
		if (name !== "style") continue;
		const css = cleanCss(attribute.value);
		if (css === "") element.removeAttribute(attribute.name);
		else element.setAttribute(attribute.name, css);
	}
}

/** Mermaid's SVG in, the same drawing with what is refused removed — or null when the string was
 * not a drawing at all, which is the caller's cue to show the source instead.
 *
 * Parsed as HTML, because that is what Mermaid's output is: a label may hold a void tag (`<img>`,
 * `<br>`) and a string that carries one is not well-formed XML, so an XML parser would refuse every
 * diagram with a broken image in its label. The HTML parser accepts it and keeps the label inside
 * its `<foreignObject>`, which is the integration point it switches parsing at.
 */
export function guardSvg(markup: string): SVGSVGElement | null {
	const template = document.createElement("template");
	template.innerHTML = markup;

	const root = template.content.firstElementChild;
	if (
		root === null ||
		root.namespaceURI !== SVG_NAMESPACE ||
		root.tagName.toLowerCase() !== "svg"
	) {
		return null;
	}

	// One of the tags the HTML parser reserves (an `<img>` in SVG position, say) closes the `<svg>`
	// early and puts what follows beside it: a fragment of a drawing, not a drawing.
	if (template.content.children.length > 1) return null;

	// The list is static, so removing an ancestor before its child is reached is safe: a removed
	// child is still walked, and only its own attributes are left to clean.
	for (const element of [root, ...root.querySelectorAll("*")]) cleanElement(element);
	return root as unknown as SVGSVGElement;
}
