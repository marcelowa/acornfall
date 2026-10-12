import { useEffect } from "react";

/**
 * The phone's keyboard, as one number.
 *
 * Android with `interactive-widget=resizes-content` shrinks the layout viewport, so the layout
 * already fits and the inset is zero. iOS moves the visual viewport instead: the layout keeps
 * its height and the keyboard covers the bottom of it, which is how the composer ended up behind
 * the keyboard (step 04, J7). The distance between the two viewports is the inset, and it is
 * written to `--keyboard-inset` for the composer to reserve. One hook, one variable, one place —
 * no screen has to know how a keyboard works.
 */
export function useKeyboardInset(): void {
	useEffect(() => {
		const viewport = window.visualViewport;
		if (viewport === null) return;
		const root = document.documentElement;

		const apply = (): void => {
			const covered = window.innerHeight - viewport.height - viewport.offsetTop;
			root.style.setProperty("--keyboard-inset", `${Math.max(0, Math.round(covered))}px`);
		};

		apply();
		viewport.addEventListener("resize", apply);
		viewport.addEventListener("scroll", apply);
		return () => {
			viewport.removeEventListener("resize", apply);
			viewport.removeEventListener("scroll", apply);
			root.style.removeProperty("--keyboard-inset");
		};
	}, []);
}
