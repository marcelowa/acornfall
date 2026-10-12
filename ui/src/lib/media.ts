import { useEffect, useState } from "react";

/**
 * The phone boundary, as one question: below `sm` (640px), which is the same line the rest of
 * the phone ladder is written at (`globals.css` moves the type steps and `--bar-height` there,
 * `Button` steps its targets there). A window narrowed to that width is a phone layout, touch
 * screen or not, so the layout answers the same way in a browser as on a phone.
 *
 * It is a hook and not a plain `matchMedia` call because the answer has to follow a rotation or
 * a window resize, and because a value read during render has to be one React can re-read.
 */
export function usePhone(): boolean {
	const query = "(max-width: 639px)";
	const [phone, setPhone] = useState(() => matches(query));

	useEffect(() => {
		if (typeof window.matchMedia !== "function") return;
		const list = window.matchMedia(query);
		const update = (): void => setPhone(list.matches);
		update();
		list.addEventListener("change", update);
		return () => list.removeEventListener("change", update);
	}, []);

	return phone;
}

function matches(query: string): boolean {
	try {
		return window.matchMedia(query).matches;
	} catch {
		return false;
	}
}
