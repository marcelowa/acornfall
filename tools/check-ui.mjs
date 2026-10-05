// A real browser smoke test. Two UI bugs shipped that curl could not see: an
// element looked up but never declared, and a modal whose visibility an author
// rule overrode. Both are visible here in one run.
//
// Needs a gateway on --addr; run with: bun run tools/check-ui.mjs [url]
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? process.env.ACORNFALL_URL ?? "http://127.0.0.1:7777";
const chrome = process.env.CHROME_PATH ?? "/usr/bin/chromium";

const failures = [];
const check = (label, ok, detail) => {
	if (!ok) failures.push(`${label}${detail === undefined ? "" : `: ${detail}`}`);
};

/**
 * Show a conversation that has a transcript, and say whether one could be found.
 *
 * The app reopens whatever you were last in, which can be a fresh, empty conversation — a
 * legitimate state that the checks below are not about. It picks from the conversations listing
 * rather than the rail, because the listing says which conversations have content.
 */
async function showConversationWithContent(page) {
	if (await page.evaluate(() => document.querySelectorAll("#transcript .turn").length > 0)) return true;
	const picked = await page.evaluate(async () => {
		const rows = await (await fetch("/api/workspaces/general/conversations")).json();
		const withContent = (rows ?? []).find(
			(row) => !row.hidden && row.parent === undefined && row.lastEntryId !== "",
		);
		if (withContent === undefined) return "";
		const button = document.querySelector(`#conversation-list [data-conversation="${withContent.id}"]`);
		if (button === null) return "";
		button.click();
		return withContent.id;
	});
	if (picked === "") return false;
	await page.waitForFunction(() => document.querySelectorAll("#transcript .turn").length > 0, {
		timeout: 20000,
		polling: 100,
	});
	return true;
}

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
	page.on("pageerror", (error) => problems.push(`page: ${error.message}
    ${(error.stack ?? "").split("\n").slice(1, 4).join("\n    ")}`));
	page.on("requestfailed", (request) => {
		// A cancelled request is deliberate, not a failure: the client replaces its event
		// stream on reconnect, and the checks below cancel one to probe liveness.
		const cancelled = /ERR_ABORTED|NS_BINDING_ABORTED/.test(request.failure()?.errorText ?? "");
		if (cancelled || request.url().endsWith("/favicon.ico")) return;
		problems.push(`request failed: ${request.url()} ${request.failure()?.errorText ?? ""}`);
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

	// 3b. The checks below are about a transcript, so make sure there is one to check.
	check(
		"a conversation with a transcript is shown",
		await showConversationWithContent(page),
		"no conversation in this install has any content",
	);

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
	// A missing button fails the first check rather than throwing on the payload it would have
	// carried: a crash here hid which check was actually unhappy.
	const payload = copyResult.payload ?? "";
	check("assistant replies offer a copy control", copyResult.present);
	check("copying reports success", copyResult.text === "Copied", `button shows ${copyResult.text}`);
	check(
		"the copied payload looks like source",
		!payload.includes("<p>") && !payload.includes("<div"),
		payload.slice(0, 80),
	);

	// 6. The settings sheet holds providers and defaults, and closes.
	await page.click("#connect");
	await page.waitForSelector("#sheet:not([hidden])", { visible: true, timeout: 5000 });
	const tabs = await page.evaluate(() =>
		[...document.querySelectorAll(".sheet-tabs .tab")].map((tab) => tab.dataset.view),
	);
	check(
		"the sheet has provider, default, command, and workspace tabs",
		tabs.join(",") === "providers,defaults,commands,workspaces",
		tabs.join(","),
	);
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

	// A resolved default is only half the answer; which layer it came from is the other half,
	// and it is what makes "why is this workspace on that model" answerable.
	const defaults = await page.evaluate(() => {
		const scope = document.querySelector("#defaults-scope");
		const rows = [...document.querySelectorAll("#sheet-body .provider")];
		const byLabel = (label) =>
			rows.find((row) => row.querySelector(".provider-name")?.textContent === label)?.querySelector(".provider-meta")
				?.textContent ?? "";
		return {
			scope: scope === null ? "" : [...scope.options].map((option) => option.value).join(","),
			model: byLabel("model"),
		};
	});
	check(
		"the defaults sheet says which layer each value came from",
		/set here|from all workspaces|last resort/.test(defaults.model),
		JSON.stringify(defaults),
	);
	check("and where its buttons write to", defaults.scope === "workspace,install", JSON.stringify(defaults));

	await page.select("#defaults-scope", "install");
	const scoped = await page.evaluate(() => ({
		stored: localStorage.getItem("acornfall.defaultsScope"),
		says: document.querySelector("#sheet-body")?.textContent?.includes("Changing every workspace."),
	}));
	check("choosing a scope sticks, and the sheet says what it will change", scoped.stored === "install" && scoped.says === true, JSON.stringify(scoped));
	await page.select("#defaults-scope", "workspace");

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

	// 8. Every pane says when it happened, and the conversation says whether it is live.
	const paneMeta = await page.evaluate(() => ({
		panes: document.querySelectorAll("#transcript .turn, #transcript .tool").length,
		withoutTime: [...document.querySelectorAll("#transcript .turn, #transcript .tool")].filter(
			(pane) => pane.querySelector(".turn-when") === null,
		).length,
		sample: document.querySelector("#transcript .turn-when")?.textContent.trim() ?? "",
		live: document.querySelector("#conversation-live").textContent.trim(),
		path: window.location.pathname,
	}));
	check("every pane carries a timestamp", paneMeta.withoutTime === 0, JSON.stringify(paneMeta));
	check("the timestamp looks like a time", /\d{1,2}:\d{2}/.test(paneMeta.sample), paneMeta.sample);
	check("the conversation says it is live", /^(working|idle)/.test(paneMeta.live), paneMeta.live);
	// A conversation's identity includes its workspace: ids are only unique inside a
	// workspace's storage, so /c/<workspace>/<conversation> is the honest address.
	check("the conversation is named in the URL", /^\/c\/[\w-]+\/[0-9]+$/.test(paneMeta.path), paneMeta.path);

	// 9. The stream proves it is alive. A comment line keeps the socket open but fires no
	//    event, so a client could not tell a healthy idle stream from a dead one -- the
	//    first version of this sent a comment and the watchdog could never fire.
	const liveness = await page.evaluate(async () => {
		const response = await fetch("/api/stream");
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let text = "";
		const deadline = Date.now() + 9000;
		while (Date.now() < deadline && !text.includes("event: ping")) {
			const { value, done } = await reader.read();
			if (done) break;
			text += decoder.decode(value, { stream: true });
		}
		await reader.cancel();
		return { ping: text.includes("event: ping"), sawState: text.includes("event: state") };
	});
	check("the stream sends a liveness event the client can see", liveness.ping, JSON.stringify(liveness));
	check("a new subscriber is given the current state", liveness.sawState, JSON.stringify(liveness));

	// 10. A message from another conversation is attributed, not shown as the user's.
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

	// 11. The delegation and created-here sections exist and read from state.
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

	// 12. Commands from the workspace are listed and put an invocation in the composer.
	await page.evaluate(() => document.querySelector('.sheet-tabs .tab[data-view="commands"]').click());
	await new Promise((resolve) => setTimeout(resolve, 1200));
	const commands = await page.evaluate(() => ({
		rows: document.querySelectorAll("#sheet-body [data-command]").length,
		names: [...document.querySelectorAll("#sheet-body .provider-name")].map((n) => n.textContent.trim()),
	}));
	if (commands.rows > 0) {
		const used = await page.evaluate(() => {
			document.querySelector("#sheet-body [data-command]").click();
			return document.querySelector("#input").value;
		});
		check("choosing a command writes its invocation into the composer", /^\/[\w-]+ $/.test(used), used);
		check("choosing a command closes the sheet", await page.evaluate(() => document.querySelector("#sheet").getBoundingClientRect().height === 0));
	}

	// 13. A workspace can be created from the interface, and it appears where it is used.
	// Reopened first: choosing a command closes the sheet, as it should.
	await page.evaluate(() => document.querySelector("#connect").click());
	await page.waitForSelector("#sheet:not([hidden])", { visible: true, timeout: 5000 });
	await page.evaluate(() => document.querySelector('.sheet-tabs .tab[data-view="workspaces"]').click());
	await page.waitForSelector("#workspace-form", { visible: true, timeout: 5000 });
	const created = await page.evaluate(async () => {
		const dir = (await (await fetch("/api/workspaces")).json()).workspacesDir;
		const form = document.querySelector("#workspace-form");
		form.querySelector('[name="name"]').value = "check-made";
		form.querySelector('[name="trusted"]').checked = false;
		form.requestSubmit();
		await new Promise((resolve) => setTimeout(resolve, 1500));
		const listing = await (await fetch("/api/workspaces")).json();
		const made = listing.workspaces.find((w) => w.name === "check-made");
		return {
			dir,
			created: made !== undefined,
			insideDir: made?.path.startsWith(`${dir}/`) === true,
			trusted: made?.trusted,
			titleMatchesName: made?.title === "check-made",
		};
	});
	check("the form creates a workspace from a name alone", created.created, JSON.stringify(created));
	check("it lands inside the workspaces folder", created.insideDir, JSON.stringify(created));
	check("its title defaults to its name, so the list and selector agree", created.titleMatchesName);
	check("trust is recorded as chosen", created.trusted === false, JSON.stringify(created));
	// Asked from here rather than from the page: a deliberate 400 is a console error in the
	// browser, and the checks count those.
	const refusal = await fetch(`${url.replace(/\/$/, "")}/api/workspaces`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ name: "should-not-exist", path: "/etc" }),
	});
	const afterRefusal = await (await fetch(`${url.replace(/\/$/, "")}/api/workspaces`)).json();
	check("a path in the body is refused, not ignored", refusal.status === 400, String(refusal.status));
	check(
		"nothing was created outside the workspaces folder",
		!afterRefusal.workspaces.some((w) => w.name === "should-not-exist"),
	);
	// 13b. Switching to it and back. This is a workspace that has never been used, so its
	//      worker starts on demand and the conversation it lands on is one nobody has named
	//      yet — which is the case that used to leave the pane empty: the tab opened its
	//      stream for the workspace it was leaving, dropped every frame for the new one as
	//      belonging to someone else, and never recovered.
	const generalBefore = await page.evaluate(() => window.location.pathname);
	await page.select("#workspace-select", "check-made");
	await page.waitForFunction(() => window.location.pathname.startsWith("/c/check-made/"), {
		timeout: 30000,
		polling: 100,
	});
	const landed = await page.evaluate(async () => {
		const answer = await (await fetch("/api/state?workspace=check-made&conversation=")).json();
		return {
			path: window.location.pathname,
			conversation: answer?.conversation?.id ?? "",
			workspace: document.querySelector("#workspace-select")?.value,
			status: document.querySelector("#status")?.textContent?.trim(),
		};
	});
	check(
		"the tab lands on a conversation the new workspace actually has",
		landed.path === `/c/check-made/${landed.conversation}` && landed.conversation !== "",
		JSON.stringify(landed),
	);
	check("and it is not left on the workspace it came from", landed.workspace === "check-made");
	check("the pane settles rather than waiting forever", landed.status === "idle", JSON.stringify(landed));

	await page.select("#workspace-select", "general");
	await page.waitForFunction(() => window.location.pathname.startsWith("/c/general/"), { timeout: 30000, polling: 100 });
	await page.waitForFunction(() => document.querySelectorAll("#transcript .turn").length > 0, { timeout: 30000, polling: 100 });
	const returned = await page.evaluate(() => ({
		path: window.location.pathname,
		turns: document.querySelectorAll("#transcript .turn").length,
		selected: document.querySelector("#workspace-select")?.value,
	}));
	check(
		"switching back restores the conversation that was on screen",
		returned.path === generalBefore && returned.turns > 0 && returned.selected === "general",
		JSON.stringify({ ...returned, generalBefore }),
	);
	check("no errors from switching workspaces", problems.length === 0, problems.join("; "));

	await page.evaluate(() => fetch("/api/workspaces/check-made/remove", { method: "POST" }));
	await new Promise((resolve) => setTimeout(resolve, 500));
	check("no errors from managing workspaces", problems.length === 0, problems.join("; "));

	// 14. Two tabs, two conversations. The conversation belongs to the URL, so tabs do not
	//     fight over one "active" conversation and a shared link opens what it names.
	// Another conversation with content, and one the rail shows — a subagent has a transcript
	// but is not in the rail, so clicking its row would be clicking nothing.
	const other = await page.evaluate(async () => {
		const shown = window.location.pathname.split("/").pop();
		const rows = await (await fetch("/api/workspaces/general/conversations")).json();
		const row = (rows ?? []).find(
			(candidate) =>
				!candidate.hidden && candidate.parent === undefined && candidate.lastEntryId !== "" && candidate.id !== shown,
		);
		return row?.id ?? "";
	});
	if (other === "") {
		check("a second conversation exists to open in a second tab", false, "only one conversation");
	} else {
		const second = await browser.newPage();
		await second.goto(`${url.replace(/\/$/, "")}/c/general/${other}`, { waitUntil: "networkidle2" });
		await second.waitForFunction(() => document.querySelectorAll("#transcript .turn").length > 0, {
			timeout: 20000,
			polling: 100,
		});
		const first = await page.evaluate(() => ({
			path: window.location.pathname,
			title: document.querySelector("#conversation-title").textContent,
		}));
		const both = await second.evaluate(() => ({
			path: window.location.pathname,
			title: document.querySelector("#conversation-title").textContent,
		}));
		check("a second tab opens the conversation its URL names", both.path.endsWith(`/c/general/${other}`), JSON.stringify(both));
		check("the first tab is untouched by the second", first.path === paneMeta.path, JSON.stringify({ first, paneMeta }));
		check("the two tabs show different conversations", first.title !== both.title, JSON.stringify({ first: first.title, second: both.title }));
		await second.close();

		// Switching inside a tab is a navigation without a reload, so nothing is lost.
		await page.evaluate(() => {
			window.__kept = "yes";
		});
		await page.evaluate((id) => document.querySelector(`#conversation-list [data-conversation="${id}"]`).click(), other);
		await page.waitForFunction((id) => window.location.pathname.endsWith(`/${id}`), { timeout: 10000 }, other);
		await page.waitForFunction(() => document.querySelectorAll("#transcript .turn").length > 0, {
			timeout: 20000,
			polling: 100,
		});
		const switched = await page.evaluate(() => ({
			kept: window.__kept === "yes",
			title: document.querySelector("#conversation-title").textContent,
			turns: document.querySelectorAll("#transcript .turn").length,
		}));
		check("switching conversations does not reload the page", switched.kept);
		check("the transcript follows the URL", switched.turns > 0, JSON.stringify(switched));
	}

	// 15. The renderer's escaping. Assistant text and tool output are untrusted — a tool result
	//     can contain anything a file or a command produced — so this is the client's one
	//     security boundary, and it is checked here rather than in a node script because the
	//     sanitizer needs a real DOM. Images are refused outright: a remote URL in a reply is
	//     an exfiltration channel, since your browser fetches it.
	const rendered = await page.evaluate(async () => {
		const { renderMarkdown } = await import("/markdown.js");
		const cases = {
			script: renderMarkdown("Look: <script>alert('x')</script>"),
			image: renderMarkdown("<img src=x onerror=alert(1)>"),
			jsLink: renderMarkdown("[click](javascript:alert(1))"),
			dataLink: renderMarkdown("[x](data:text/html;base64,PHNjcmlwdD4=)"),
			goodLink: renderMarkdown("[docs](https://example.com/a?b=1)"),
			code: renderMarkdown("```js\nconst x = 1;\n```"),
			ansi: renderMarkdown("\u001b[31mred\u001b[0m"),
		};
		return {
			scriptTag: cases.script.includes("<script"),
			scriptEscaped: cases.script.includes("&lt;script&gt;"),
			imageTag: cases.image.includes("<img"),
			jsHref: /<a[^>]+href=["']?javascript:/i.test(cases.jsLink),
			jsLabel: cases.jsLink.includes("click"),
			dataHref: /<a[^>]+href=["']?data:/i.test(cases.dataLink),
			goodHref: /<a[^>]+href="https:\/\/example\.com/.test(cases.goodLink),
			privateRel: /rel="noreferrer noopener"/.test(cases.goodLink),
			highlighted: cases.code.includes('class="hljs language-js"'),
			ansiStripped: !cases.ansi.includes("\u001b"),
		};
	});
	check(
		"raw HTML in a reply is escaped, not rendered",
		rendered.scriptTag === false && rendered.scriptEscaped === true && rendered.imageTag === false,
		JSON.stringify(rendered),
	);
	check(
		"javascript: and data: links are not turned into links",
		rendered.jsHref === false && rendered.dataHref === false && rendered.jsLabel === true,
		JSON.stringify(rendered),
	);
	check(
		"an ordinary link still works, and opens without a referrer",
		rendered.goodHref === true && rendered.privateRel === true,
		JSON.stringify(rendered),
	);
	check("fenced code is highlighted", rendered.highlighted === true, JSON.stringify(rendered));
	check("terminal escape codes are stripped", rendered.ansiStripped === true, JSON.stringify(rendered));
} catch (error) {
	// A crash skips the summary below, which is where check failures are reported — so a run
	// failed with a stack and nothing about the checks that had already gone wrong.
	if (failures.length > 0) console.error(`checks so far:\n  - ${failures.join("\n  - ")}`);
	throw error;
} finally {
	await browser.close();
}

if (failures.length > 0) {
	console.error(`ui check failed:\n  - ${failures.join("\n  - ")}`);
	process.exit(1);
}
console.log(`ui check ok: ${url}`);
