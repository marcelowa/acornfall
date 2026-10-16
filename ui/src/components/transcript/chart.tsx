import { Text } from "@/components/typography/text";
import { ClippedText } from "@/components/ui/clipped-text";
import { chartRefusal, parseChart } from "./chart-source";
// The refusal shows the source as the reply would have shown it, and those code-block styles are
// the markdown renderer's.
import "./markdown.css";
import "./chart.css";

/**
 * One chart from a fence: a bar per line, scaled to the longest, and the value printed beside each
 * one — the reader compares the lengths to see which is bigger and the numbers to see by how much.
 *
 * The bars are elements, not SVG: the renderer builds them here, so the labels are React text and
 * there is no second sanitiser between the model's words and the screen. Nothing draws while the
 * text is still arriving, because `Markdown` keeps an open fence as text.
 */
export interface ChartProps {
	/** The fence's body, exactly as the model wrote it. */
	source: string;
}

export function Chart({ source }: ChartProps) {
	const points = parseChart(source);

	if (points === undefined) {
		return (
			<div className="chart-block" data-state="refused">
				<div className="code-block">
					<span className="code-lang">chart</span>
					<pre>
						<code>{source}</code>
					</pre>
				</div>
				<Text as="p" size="sm" tone="muted" className="chart-note">
					Chart not drawn: {chartRefusal(source)}
				</Text>
			</div>
		);
	}

	const most = Math.max(...points.map((point) => point.value));

	return (
		<div className="chart-block">
			{points.map((point, index) => (
				<div className="chart-row" key={`${point.label}-${index}`}>
					<ClippedText text={point.label} className="chart-label" />
					<span className="chart-track">
						<span
							className="chart-bar"
							// The one inline style in the console's transcript, and it has to be one:
							// a length is what has no class.
							style={{
								inlineSize: most === 0 ? "0%" : `${(point.value / most) * 100}%`,
							}}
						/>
					</span>
					<Text
						as="span"
						size="2xs"
						tone="muted"
						className="chart-value font-mono tabular-nums"
					>
						{point.value}
					</Text>
				</div>
			))}
		</div>
	);
}
