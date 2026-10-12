import { useEffect, useState } from "react";

/**
 * The current time, re-read on an interval.
 *
 * The rail prints how long ago a conversation moved, and dims a run's dot when it stops moving.
 * Both are decisions about "now", and nothing re-renders a page that is sitting still: without a
 * tick, a still console could hold a pulsing dot beside an age that stopped moving, which is the
 * one thing the row was added to prevent.
 */
export function useNow(intervalMs = 60_000): Date {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(new Date()), intervalMs);
		return () => window.clearInterval(timer);
	}, [intervalMs]);
	return now;
}
