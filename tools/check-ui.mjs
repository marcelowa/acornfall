// A real browser smoke test. Two UI bugs shipped that curl could not see: an
// element looked up but never declared, and a modal whose visibility an author
// rule overrode. Both are visible here in one run.
//
// Needs a gateway on --addr; run with: bun run tools/check-ui.mjs [url]
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? process.env.ACORNFALL_URL ?? "http://100.107.166.15:7777";
const chrome = process.env.CHROME_PATH ?? "/usr/bin/chromium";

const failures = [];
const check = (label, ok, detail) => {
	if (!ok) failures.push(`${label}${detail === undefined ? "" : `: ${detail}`}`);
};

const browser = await puppeteer.launch({
	executablePath: chrome,
	headless: true,
	args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
	const page = await browser.newPage();
	await page.setViewport({ width: 1400, height: 900 });

	const problems = [];
	page.on("console", (message) => {
		if (message.type() === "error") problems.push(`console: ${message.text()}`);
	});
	page.on("pageerror", (error) => problems.push(`page: ${error.message}`));
	page.on("requestfailed", (request) => {
		if (!request.url().endsWith("/favicon.ico")) problems.push(`request failed: ${request.url()}`);
	});

	const response = await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
	check("the page loads", response !== null && response.status() === 200, `status ${response?.status()}`);

	// Let the first state render and the stream connect.
	await page.waitForFunction(() => document.querySelector("#status")?.textContent !== "connecting", {
		timeout: 15000,
	});
	check("no JavaScript errors", problems.length === 0, problems.join("; "));

	// Before anything clicks: a visible overlay swallows the first interaction and
	// turns one root cause into a confusing trail of failures.
	const sheetVisible = await page.evaluate(
		() => document.querySelector("#sheet").getBoundingClientRect().height > 0,
	);
	check("the settings sheet starts hidden", !sheetVisible, "the sheet is on screen at load");

	const panelWidth = (property) =>
		page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), property);

	// 1. Panel geometry persists.
	const railBefore = await page.evaluate(
		() => document.querySelector("#split-rail").getBoundingClientRect().left,
	);
	const handle = await page.$("#split-rail");
	const box = await handle.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + 200);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 90, box.y + 200, { steps: 8 });
	await page.mouse.up();
	const railAfter = await page.evaluate(
		() => document.querySelector("#split-rail").getBoundingClientRect().left,
	);
	check("dragging the left splitter resizes the rail", railAfter > railBefore + 40, `${railBefore} → ${railAfter}`);
	const saved = await page.evaluate(() => localStorage.getItem("acornfall.rail"));
	check("the new rail width is saved", saved !== null && Number(saved) > 200, `saved ${saved}`);

	// 2. Sections are an accordion, closed by default, and persist.
	const sectionState = await page.evaluate(() =>
		[...document.querySelectorAll("#inspector details.card")].map((details) => ({
			key: details.dataset.section,
			open: details.open,
		})),
	);
	check("the inspector has sections", sectionState.length >= 5, `${sectionState.length} sections`);
	check(
		"sections are closed on first load",
		sectionState.every((section) => !section.open),
		sectionState.filter((s) => s.open).map((s) => s.key).join(", "),
	);

	const firstKey = sectionState[0]?.key;
	await page.click(`#inspector details[data-section="${firstKey}"] > summary`);
	await page.waitForFunction(
		(key) => document.querySelector(`#inspector details[data-section="${key}"]`).open,
		{ timeout: 5000 },
		firstKey,
	);
	await page.waitForFunction(
		(key) => (document.querySelector(`#inspector details[data-section="${key}"] .card-body`).innerHTML.length > 0),
		{ timeout: 5000 },
		firstKey,
	);
	check("opening a section renders its body", true);
	const persisted = await page.evaluate(() => localStorage.getItem("acornfall.sections"));
	check("open state is saved", String(persisted).includes(firstKey), `saved ${persisted}`);

	// 3. Maximize takes the sidebar and restores.
	await page.click(`#inspector details[data-section="${firstKey}"] [data-max="${firstKey}"]`);
	const focused = await page.evaluate(() => document.querySelector("#inspector").classList.contains("focused"));
	const maximized = await page.evaluate(
		(key) => document.querySelector(`#inspector details[data-section="${key}"]`).classList.contains("maximized"),
		firstKey,
	);
	const visibleCards = await page.evaluate(
		() =>
			[...document.querySelectorAll("#inspector details.card")].filter(
				(details) => details.getBoundingClientRect().height > 0,
			).length,
	);
	check("maximize focuses the section", focused && maximized);
	check("the other sections collapse while maximized", visibleCards === 1, `${visibleCards} visible`);
	await page.click(`#inspector details[data-section="${firstKey}"] [data-max="${firstKey}"]`);
	const restoredCards = await page.evaluate(
		() =>
			[...document.querySelectorAll("#inspector details.card")].filter(
				(details) => details.getBoundingClientRect().height > 0,
			).length,
	);
	check("restoring brings the other sections back", restoredCards > 1, `${restoredCards} visible`);

	// 4. Nothing in the transcript is squashed. A scrolling flex column lets the
	// browser compress items with overflow:hidden to zero; a long conversation is
	// all it takes.
	const squashed = await page.evaluate(() =>
		[...document.querySelectorAll("#transcript > *")]
			.filter((child) => child.getBoundingClientRect().height < 8)
			.map((child) => `${child.className}: ${Math.round(child.getBoundingClientRect().height)}px`),
	);
	check("no transcript item is squashed", squashed.length === 0, squashed.join(", "));

	const toolHeights = await page.evaluate(() =>
		[...document.querySelectorAll("#transcript .tool")].map((tool) => ({
			card: Math.round(tool.getBoundingClientRect().height),
			output: tool.querySelector("pre") ? Math.round(tool.querySelector("pre").getBoundingClientRect().height) : 0,
		})),
	);
	const clipped = toolHeights.filter((item) => item.output > 8 && item.card < item.output);
	check("tool cards are at least as tall as their output", clipped.length === 0, JSON.stringify(clipped));

	// 5. Markdown rendering, exercised through the real sanitizer in a real
	// browser. jsdom would not do: DOMPurify leans on the host parser, and the host
	// parser is where mXSS lives.
	const markdown = await page.evaluate(async () => {
		const { renderMarkdown } = await import("/markdown.js");
		return {
			script: renderMarkdown("Look: <script>alert(1)<\/script>"),
			handler: renderMarkdown('<img src=x onerror=alert(1)>'),
			jsLink: renderMarkdown("[click](javascript:alert(1))"),
			image: renderMarkdown("![tracker](https://example.com/pixel.png)"),
			table: renderMarkdown("| a | b |\n| --- | ---: |\n| 1 | 2 |"),
			code: renderMarkdown("```js\nconst x = 1;\n```"),
			plainCode: renderMarkdown("```\nplain\n```"),
			strong: renderMarkdown("**bold**"),
			list: renderMarkdown("- one\n- two"),
			link: renderMarkdown("[docs](https://example.com)"),
			break: renderMarkdown("one\ntwo"),
		};
	});
	check("markdown renders emphasis", markdown.strong.includes("<strong>"), markdown.strong);
	check("markdown renders lists", markdown.list.includes("<li>"), markdown.list);
	check("markdown renders tables", markdown.table.includes("<table>"), markdown.table);
	check("single newlines stay line breaks", markdown.break.includes("<br"), markdown.break);
	check("links are hardened", markdown.link.includes('rel="noreferrer'), markdown.link);

	check("syntax highlighting runs", markdown.code.includes("hljs-"), markdown.code.slice(0, 120));
	check("an unknown language still renders as code", markdown.plainCode.includes("<pre>"), markdown.plainCode);

	check("raw script tags do not survive", !markdown.script.includes("<script"), markdown.script);
	check("the script text is still visible", markdown.script.includes("&lt;script&gt;"), markdown.script);
	// Raw HTML is escaped rather than sanitised, so the tag cannot become an element
	// and its handler never exists as an attribute. The words remain visible, which
	// is the point: a reply cannot quietly inject markup.
	check("raw html does not become an element", !markdown.handler.includes("<img"), markdown.handler);
	check("its text is still shown", markdown.handler.includes("&lt;img"), markdown.handler);
	check("javascript: links lose their href", !markdown.jsLink.includes("javascript:"), markdown.jsLink);
	check("images are refused", !markdown.image.includes("<img"), markdown.image);

	// 6. Each pane decides its own formatting, and the controls are always visible.
	const controls = await page.evaluate(() =>
		[...document.querySelectorAll("#transcript .turn.assistant, #transcript .tool")].map((pane) => {
			const tools = pane.querySelector(".turn-tools");
			return {
				type: pane.classList.contains("tool") ? "tool" : "assistant",
				visible: tools !== null && getComputedStyle(tools).opacity !== "0",
				format: pane.querySelector("[data-format]") !== null,
				copy: pane.querySelector("[data-copy]") !== null,
			};
		}),
	);
	check("every pane carries its controls", controls.length > 0 && controls.every((pane) => pane.visible && pane.copy));
	check("assistant panes offer a format toggle", controls.filter((p) => p.type === "assistant").every((p) => p.format));
	check("tool panes do not offer a format toggle", controls.filter((p) => p.type === "tool").every((p) => !p.format));

	const perPane = await page.evaluate(() => {
		const panes = [...document.querySelectorAll("#transcript .turn.assistant")];
		const html = panes.map((pane) => pane.querySelector(".markdown, .plain")?.className ?? "");
		return { count: panes.length, before: html };
	});
	if (perPane.count > 0) {
		await page.evaluate(() => document.querySelector("#transcript .turn.assistant [data-format]").click());
		const after = await page.evaluate(() => {
			const panes = [...document.querySelectorAll("#transcript .turn.assistant")];
			return {
				html: panes.map((pane) => pane.querySelector(".markdown, .plain")?.className ?? ""),
				label: panes[0].querySelector("[data-format]").textContent,
			};
		});
		check("clicking a pane's toggle makes that pane raw", after.html[0] === "plain", after.html[0]);
		check("the pane's button offers the way back", after.label === "Formatted", after.label);
		if (perPane.count > 1) {
			check(
				"other panes are unaffected",
				after.html.slice(1).every((value, index) => value === perPane.before[index + 1]),
				JSON.stringify({ before: perPane.before, after: after.html }),
			);
		}
		await page.evaluate(() => document.querySelector("#transcript .turn.assistant [data-format]").click());
		const restored = await page.evaluate(() =>
			[...document.querySelectorAll("#transcript .turn.assistant")].map(
				(pane) => pane.querySelector(".markdown, .plain")?.className ?? "",
			),
		);
		check("toggling back restores that pane only", restored.join() === perPane.before.join());
	}

	// A pane must hug its content. Rendered markdown inherited white-space:pre-wrap
	// once, and every newline marked emits between block elements became a blank
	// line: 323px of pane for 167px of content.
	//
	// Measured inside the body, not around it: the extra height inflates the
	// markdown box itself, so a pane-level check sees nothing wrong.
	const slack = await page.evaluate(() =>
		[...document.querySelectorAll("#transcript .markdown")]
			.map((body) => {
				// A child's margins sit outside its box, so they count as its space.
				// Summing them overestimates where they collapse, which can only make
				// the result negative, and this only flags positive values.
				const inner = [...body.children].reduce((sum, child) => {
					const style = getComputedStyle(child);
					return (
						sum +
						child.getBoundingClientRect().height +
						Number.parseFloat(style.marginTop) +
						Number.parseFloat(style.marginBottom)
					);
				}, 0);
				return Math.round(body.clientHeight - inner);
			})
			.filter((value) => value > 16),
	);
	check(
		"rendered replies have no dead space",
		slack.length === 0,
		`${slack.length} bodies with unexplained height: ${slack.join(", ")}`,
	);

	// A reply should use the column rather than stopping at an arbitrary width.
	const width = await page.evaluate(() => {
		const pane = document.querySelector("#transcript .turn.assistant");
		const transcript = document.querySelector("#transcript");
		if (pane === null) return null;
		return {
			pane: Math.round(pane.getBoundingClientRect().width),
			inner: Math.round(transcript.clientWidth - 40),
		};
	});
	if (width !== null) {
		check("a reply fills the available width", width.pane >= width.inner - 2, JSON.stringify(width));
	}

	// 7. Copy puts the source on the clipboard, not the rendered text.
	const copyResult = await page.evaluate(async () => {
		const button = document.querySelector("#transcript .turn.assistant [data-copy]");
		if (button === null) return { present: false };
		button.click();
		await new Promise((resolve) => setTimeout(resolve, 300));
		return { present: true, text: button.textContent, payload: decodeURIComponent(button.dataset.copy) };
	});
	check("assistant replies offer a copy control", copyResult.present);
	check("copying reports success", copyResult.text === "Copied", `button shows ${copyResult.text}`);
	check(
		"the copied payload looks like source",
		!copyResult.payload.includes("<p>") && !copyResult.payload.includes("<div"),
		copyResult.payload.slice(0, 80),
	);

	// 6. The settings sheet holds providers and defaults, and closes.
	await page.click("#connect");
	await page.waitForSelector("#sheet:not([hidden])", { visible: true, timeout: 5000 });
	const tabs = await page.evaluate(() =>
		[...document.querySelectorAll(".sheet-tabs .tab")].map((tab) => tab.dataset.view),
	);
	check("the sheet has provider and default tabs", tabs.join(",") === "providers,defaults", tabs.join(","));
	await page.click('.sheet-tabs .tab[data-view="defaults"]');
	await page.waitForFunction(
		() => document.querySelectorAll("#sheet-body .provider").length >= 3,
		{ timeout: 5000 },
	);
	const defaultLabels = await page.evaluate(() =>
		[...document.querySelectorAll("#sheet-body .provider .provider-name")].map((node) => node.textContent),
	);
	check(
		"defaults shows model, thinking, and agent",
		defaultLabels.join(",") === "model,thinking,agent",
		defaultLabels.join(","),
	);

	// Escape closes it, which the modal bug made impossible once.
	await page.keyboard.press("Escape");
	await page.waitForFunction(() => document.querySelector("#sheet").getBoundingClientRect().height === 0, {
		timeout: 5000,
	});
	check("escape closes the sheet", true);

	// The inspector must not contain the defaults any more.
	const inspectorText = await page.evaluate(() => document.querySelector("#inspector").textContent);
	check("defaults left the inspector", !inspectorText.includes("Defaults"), "found 'Defaults' in the inspector");

	check("still no JavaScript errors after interacting", problems.length === 0, problems.join("; "));

	// 8. A message from another conversation is attributed, not shown as the user's.
	//    It arrives as a pi.user entry because that is what starts a run, so the
	//    interface has to say who sent it or a peer's transcript lies about you.
	const attribution = await page.evaluate(async () => {
		const state = await (await fetch("/api/state")).json();
		const active = state.conversation?.id;
		const doc = await (await fetch(`/api/conversations/${active}/messages`)).json();
		const ids = Object.keys(doc.state?.senders ?? {});
		const rendered = [...document.querySelectorAll("#transcript .turn")].map((turn) => ({
			agent: turn.classList.contains("agent-message"),
			user: turn.classList.contains("user"),
			label: turn.querySelector(".agent-message-head")?.textContent ?? "",
		}));
		return { ids: ids.length, agentMessages: rendered.filter((r) => r.agent), plainUser: rendered.filter((r) => r.user) };
	});
	if (attribution.ids > 0) {
		check(
			"a message from another conversation is not styled as the user's",
			attribution.agentMessages.length > 0,
			`${attribution.ids} attributed entries but no agent-message element`,
		);
		check(
			"it names its sender",
			attribution.agentMessages.every((m) => /conversation \d+/.test(m.label)),
			JSON.stringify(attribution.agentMessages.map((m) => m.label)),
		);
	}

	// 9. The rail shows live state, and a subagent is not a peer.
	const rail = await page.evaluate(() =>
		[...document.querySelectorAll("#conversation-list .conversation-item")].map((row) => ({
			id: row.dataset.id,
			title: row.querySelector(".title")?.textContent ?? "",
			mark: row.querySelector(".dot")?.className ?? "",
			usage: row.querySelector(".id")?.textContent ?? "",
		})),
	);
	check("the rail lists conversations", rail.length > 0, `${rail.length} rows`);

	const listed = await page.evaluate(async () => {
		const state = await (await fetch("/api/state")).json();
		const created = state.conversations.filter((c) => c.createdBy);
		const rail = [...document.querySelectorAll("#conversation-list .conversation-item")];
		return {
			total: state.conversations.length,
			subagents: state.conversations.filter((c) => c.parent).map((c) => c.id),
			spend: state.conversations.filter((c) => c.tokens > 0).length,
			// Identity belongs in text next to the id, like "·root"; a third coloured dot
			// beside running and unread would be three meanings for one shape.
			peersTagged: created.filter((c) => {
				const row = rail.find((r) => r.dataset.id === c.id);
				return row !== undefined && /·peer/.test(row.textContent);
			}).length,
			peerDots: document.querySelectorAll("#conversation-list .dot.peer").length,
			stateDots: document.querySelectorAll("#conversation-list .dot").length,
		};
	});
	if (listed.peersTagged > 0) {
		check(
			"an agent-created conversation is tagged in text, not by a third dot",
			listed.peerDots === 0,
			JSON.stringify({ tagged: listed.peersTagged, peerDots: listed.peerDots }),
		);
	}
	if (listed.subagents.length > 0) {
		check(
			"subagent conversations stay out of the rail",
			listed.subagents.every((id) => !rail.some((row) => row.id === id)),
			`subagents ${listed.subagents.join(", ")} appear in the rail`,
		);
	}
	check("per-conversation spend is reported", listed.spend > 0, "no conversation reports tokens");

	// 10. The delegation and created-here sections exist and read from state.
	await page.evaluate(() => {
		for (const details of document.querySelectorAll("#inspector details.card")) {
			if (["delegation", "subagents"].includes(details.dataset.section)) details.open = true;
		}
	});
	await new Promise((resolve) => setTimeout(resolve, 300));
	const sections = await page.evaluate(() => ({
		delegation: document.querySelector('[data-body="delegation"]')?.textContent.trim() ?? "",
		subagents: document.querySelector('[data-body="subagents"]')?.textContent.trim() ?? "",
	}));
	// textContent has no whitespace between a <dt> label and its <dd> value.
	check("the delegation section reports the policy", /depth\s*\d+\s*of max\s*\d+/.test(sections.delegation), sections.delegation.slice(0, 120));
	check("the delegation section names its limit", /children\s*\d+\s*of max\s*\d+/.test(sections.delegation), sections.delegation.slice(0, 120));
	check("the created-here section renders", sections.subagents.length > 0, "empty");

	// A conversation an agent created is not the same as one of yours, and the rail
	// has to say so rather than presenting it as a peer of your own conversations.
	const peers = await page.evaluate(async () => {
		const state = await (await fetch("/api/state")).json();
		const created = state.conversations.filter((c) => c.createdBy);
		const rail = [...document.querySelectorAll("#conversation-list .conversation-item")];
		return {
			created: created.map((c) => c.id),
			marked: created
				.filter((c) => c.parent === undefined || c.parent === "")
				.filter((c) => rail.some((row) => row.dataset.id === c.id && row.querySelector(".dot.peer") !== null))
				.length,
			inRail: created.filter((c) => rail.some((row) => row.dataset.id === c.id)).length,
		};
	});
	check("the policy reports the workspace peer count", /peers here\s*\d+\s*of max\s*\d+/.test(sections.delegation), sections.delegation.slice(0, 200));

	check("no errors after the delegation checks", problems.length === 0, problems.join("; "));

	// Reload: geometry and open sections must come back.
	await page.reload({ waitUntil: "networkidle2" });
	await page.waitForFunction(() => document.querySelector("#status")?.textContent !== "connecting", {
		timeout: 15000,
	});
	const railReloaded = await page.evaluate(() => document.querySelector("#split-rail").getBoundingClientRect().left);
	check("the rail width survives a reload", Math.abs(railReloaded - railAfter) <= 2, `${railAfter} → ${railReloaded}`);
	const openAfterReload = await page.evaluate(
		(key) => document.querySelector(`#inspector details[data-section="${key}"]`).open,
		firstKey,
	);
	check("the open section survives a reload", openAfterReload);
	check("no errors after reload", problems.length === 0, problems.join("; "));
} finally {
	await browser.close();
}

if (failures.length > 0) {
	console.error(`ui check failed:\n  - ${failures.join("\n  - ")}`);
	process.exit(1);
}
console.log(`ui check ok: ${url}`);
