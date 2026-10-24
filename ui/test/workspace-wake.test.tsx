import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceWakeNotice } from "../src/components/workspace/workspace-wake-notice";

test("a waking workspace is a condition, not a harness failure", () => {
	const html = renderToStaticMarkup(<WorkspaceWakeNotice name="marc-02" />);
	expect(html).toContain("Waking");
	expect(html).toContain("marc-02");
	expect(html).toContain("harness and sandbox are starting");
	expect(html).not.toContain("harness down");
});
