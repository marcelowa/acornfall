import { useEffect, useState } from "react";

/**
 * One place that asks the browser a question about size or pointer, and the one place that has to
 * survive a runtime without `matchMedia` (a test, a renderer with no window): everywhere else can
 * rely on the answer being a boolean.
 */
export function matchesQuery(query: string): boolean {
	return media(query)?.matches ?? false;
}

function media(query: string): MediaQueryList | undefined {
	try {
		return window.matchMedia(query);
	} catch {
		return undefined;
	}
}

/**
 * The phone boundary, as one question: below `sm` (640px), which is the same line the rest of the
 * phone ladder is written at (`globals.css` moves the type steps and `--bar-height` there,
 * `Button` steps its targets there). A window narrowed to that width is a phone layout, touch
 * screen or not, so the layout answers the same way in a browser as on a phone.
 *
 * It is a hook and not a plain call because the answer has to follow a rotation or a window
 * resize, and because a value read during render has to be one React can re-read.
 */
export function usePhone(): boolean {
	const [phone, setPhone] = useState(() => matchesQuery(PHONE));

	useEffect(() => {
		const list = media(PHONE);
		if (list === undefined) return;
		const update = (): void => setPhone(list.matches);
		update();
		list.addEventListener("change", update);
		return () => list.removeEventListener("change", update);
	}, []);

	return phone;
}

/** Below `sm`: the phone ladder's own boundary, written once. */
export const PHONE = "(max-width: 639px)";

/** A touch screen: Enter must not send there, and the fold is for a thumb. */
export const COARSE_POINTER = "(pointer: coarse)";
