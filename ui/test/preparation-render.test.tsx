import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	WorkspacePreparationNotice,
	WorkspacePreparationRow,
} from "../src/components/workspace/workspace-preparation";
import { TooltipProvider } from "../src/components/ui/tooltip";

const noop = () => undefined;
test("row says preparing and does not offer Open", () => {
	const html = renderToStaticMarkup(
		<TooltipProvider>
			<WorkspacePreparationRow
				preparation={{ name: "new-one", phase: "preparing", startedAt: Date.now() }}
				onOpen={noop}
				onDismiss={noop}
				onRetry={noop}
			/>
		</TooltipProvider>,
	);
	expect(html).toContain("preparing");
	expect(html).not.toContain(">Open<");
});
test("notice says preparing and does not offer Open", () => {
	const html = renderToStaticMarkup(
		<WorkspacePreparationNotice
			preparation={{ name: "new-one", phase: "preparing", startedAt: Date.now() }}
			onOpen={noop}
			onDismiss={noop}
			onRetry={noop}
		/>,
	);
	expect(html).toContain("is preparing");
	expect(html).not.toContain(">Open<");
});

test("notice says ready and offers Open", () => {
	const html = renderToStaticMarkup(
		<WorkspacePreparationNotice
			preparation={{ name: "new-one", phase: "ready", startedAt: Date.now() }}
			onOpen={noop}
			onDismiss={noop}
			onRetry={noop}
		/>,
	);
	expect(html).toContain("is ready");
	expect(html).toContain(">Open<");
});
