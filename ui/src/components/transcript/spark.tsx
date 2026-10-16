import { Text } from "@/components/typography/text";
import { parseSpark, sparkRefusal } from "./spark-source";
// The refusal shows the source as the reply would have shown it, and those code-block styles are
// the markdown renderer's.
import "./markdown.css";
import "./spark.css";

/**
 * One sparkline from a fence: the shape of the numbers, with the first and the last value printed
 * at the ends. The line says which way it went, the two numbers say from where to where.
 *
 * The line is an SVG this component builds, not a string from anywhere: it is one `polyline` of
 * coordinates, and the numbers beside it are React text. Nothing draws while the text is still
 * arriving, because `Markdown` keeps an open fence as text.
 */
export interface SparkProps {
	/** The fence's body, exactly as the model wrote it. */
	source: string;
}

export function Spark({ source }: SparkProps) {
	const values = parseSpark(source);

	if (values === undefined) {
		return (
			<div className="spark-block" data-state="refused">
				<div className="code-block">
					<span className="code-lang">spark</span>
					<pre>
						<code>{source}</code>
					</pre>
				</div>
				<Text as="p" size="sm" tone="muted" className="spark-note">
					Spark not drawn: {sparkRefusal(source)}
				</Text>
			</div>
		);
	}

	const first = values.at(0) ?? 0;
	const last = values.at(-1) ?? first;
	const least = Math.min(...values);
	const most = Math.max(...values);
	const span = most - least;
	const height = 24;
	const points = values
		.map((value, index) => {
			// Inset by half a stroke, so the ends and the peaks are drawn rather than clipped.
			const across = 1 + (index / (values.length - 1)) * 98;
			// A flat line is drawn flat through the middle rather than on the floor of the box.
			const down =
				span === 0 ? height / 2 : height - 1.5 - ((value - least) / span) * (height - 3);
			return `${across.toFixed(2)},${down.toFixed(2)}`;
		})
		.join(" ");

	return (
		<div className="spark-block">
			<Text as="span" size="2xs" tone="muted" className="spark-end font-mono tabular-nums">
				{first}
			</Text>
			<svg
				className="spark-line"
				viewBox={`0 0 100 ${height}`}
				preserveAspectRatio="none"
				aria-hidden="true"
			>
				<polyline
					points={points}
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					vectorEffect="non-scaling-stroke"
					strokeLinejoin="round"
					strokeLinecap="round"
				/>
			</svg>
			<Text as="span" size="2xs" tone="muted" className="spark-end font-mono tabular-nums">
				{last}
			</Text>
		</div>
	);
}
