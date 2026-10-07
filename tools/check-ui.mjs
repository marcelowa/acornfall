// The interface's browser suite: the behaviours a curl cannot see. It drives the built client
// the gateway serves, and it keeps the failures this file was written for — a splitter that
// does not persist, transcript items a flex column squashed to nothing, tool cards that clip
// their own output, pane controls that are not per-pane, a rail that eats a phone's width.
//
// Markdown parsing and sanitising are unit tests in `ui/test/render-markdown.test.ts`: they
// need a DOM, not a browser, and the host parser is the thing that varies. This suite only
// has to prove the pane renders through the real bundle.
//
// The inspector and the settings sheet are not here yet; they arrive with #13, and the
// assertions that covered the old client's versions of them belong there.
//
// Needs a gateway on --addr; run with: bun run tools/check-ui.mjs [url]
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? process.env.ACORNFALL_URL ?? "http://127.0.0.1:7777";
const chrome = process.env.CHROME_PATH ?? "/usr/bin/chromium";

let passed = 0;
const failures = [];
const check = (label, ok, detail) => {
	if (ok) {
		passed += 1;
		return;
	}
	failures.push(`${label}${detail === undefined ? "" : `: ${detail}`}`);
};

const PANES = "[data-slot=transcript] [data-slot=user], [data-slot=transcript] [data-slot=assistant], [data-slot=transcript] [data-slot=tool], [data-slot=transcript] [data-slot=notice]";

/**
 * Show a conversation that has a transcript, and say whether one could be found. The app
 * reopens whatever you were last in, which can be a fresh, empty conversation — a legitimate
 * state this suite is not about.
 */
async function showConversationWithContent(page) {
	if (await page.evaluate((selector) => document.querySelectorAll(selector).length > 0, PANES)) {
		return true;
	}
	const picked = await page.evaluate(async () => {
		const rows = await (await fetch("/api/workspaces/general/conversations")).json();
		const withContent = (rows ?? []).find(
			(row) => !row.hidden && row.parent === undefined && row.lastEntryId !== "",
		);
		if (withContent === undefined) return "";
		const button = document.querySelector(
			`[data-slot=conversation-select][data-conversation="${withContent.id}"]`,
		);
		if (button === null) return "";
		button.click();
		return withContent.id;
	});
	if (picked === "") return false;
	await page.waitForFunction(
		(selector) => document.querySelectorAll(selector).length > 0,
		{ timeout: 20000, polling: 100 },
		PANES,
	);
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
	page.on("pageerror", (error) => problems.push(`page: ${error.message}`));
	page.on("requestfailed", (request) => {
		// A cancelled request is deliberate: the client replaces its event stream on
		// reconnect. A missing favicon is a cosmetic wart, not a failure.
		const cancelled = /ERR_ABORTED|NS_BINDING_ABORTED/.test(request.failure()?.errorText ?? "");
		if (cancelled || request.url().endsWith("/favicon.ico")) return;
		problems.push(`request failed: ${request.url()} ${request.failure()?.errorText ?? ""}`);
	});

	const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
	check("the page loads", response !== null && response.status() === 200, `status ${response?.status()}`);
	await page.waitForSelector("[data-slot=conversation-list]", { timeout: 15000 });
	await page.waitForSelector("[data-slot=splitter]", { timeout: 10000 });
	check("the rail renders", true);

	// 2. The rail is a pane, not the page: a long list scrolls inside it, and the document
	// itself never grows — a page that scrolls moves every panel, including the ones that
	// were meant to stay put.
	const geometry = await page.evaluate(() => {
		const list = document.querySelector("[data-slot=conversation-list]");
		return {
			documentScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
			documentHeight: document.documentElement.scrollHeight,
			windowHeight: window.innerHeight,
			listOverflowY: list === null ? "" : getComputedStyle(list).overflowY,
			listScrolls: list !== null && list.scrollHeight > list.clientHeight,
		};
	});
	check(
		"the page itself does not scroll",
		!geometry.documentScrolls,
		`${geometry.documentHeight}px of document in a ${geometry.windowHeight}px window`,
	);
	check(
		"a rail that overflows scrolls inside its pane",
		!geometry.listScrolls || geometry.listOverflowY === "auto",
		`overflow-y: ${geometry.listOverflowY}`,
	);

	// 1. The splitter resizes the rail and the choice survives a reload.
	const railWidth = () =>
		page.evaluate(() => document.querySelector("aside")?.getBoundingClientRect().width ?? 0);
	const railBefore = await railWidth();
	const handle = await page.$("[data-slot=splitter]");
	const box = await handle.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 8 });
	await page.mouse.up();
	const railAfter = await railWidth();
	check(
		"dragging the splitter resizes the rail",
		railAfter > railBefore + 40,
		`${Math.round(railBefore)} → ${Math.round(railAfter)}`,
	);
	const saved = await page.evaluate(() => localStorage.getItem("acornfall.ui.railWidth"));
	check("the new rail width is saved", saved !== null && Number(saved) > 200, `saved ${saved}`);
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.waitForSelector("[data-slot=splitter]", { timeout: 15000 });
	const railReloaded = await railWidth();
	check(
		"the rail width survives a reload",
		Math.abs(railReloaded - railAfter) < 1,
		`${Math.round(railAfter)} → ${Math.round(railReloaded)}`,
	);

	// The rail is a column that can be put away on a wide screen, and the choice is remembered.
	const hideRail = await page.$("button[aria-label='Hide the rail']");
	check("the rail can be put away", hideRail !== null);
	if (hideRail !== null) {
		await hideRail.click();
		const hidden = await railWidth();
		check("hiding the rail leaves the pane to the transcript", hidden === 0, `${hidden}px`);
		await page.reload({ waitUntil: "domcontentloaded" });
		await page.waitForSelector("[data-slot=composer]", { timeout: 15000 });
		const stillHidden = await railWidth();
		check("the rail stays away after a reload", stillHidden === 0, `${stillHidden}px`);
		const showRail = await page.$("button[aria-label='Show the rail']");
		if (showRail !== null) {
			await showRail.click();
			const back = await railWidth();
			check("the rail comes back", back > 200, `${back}px`);
		}
	}

	// 2. The transcript renders, and nothing in it is squashed or clipped.
	const found = await showConversationWithContent(page);
	check("a conversation with content is on screen", found, "no conversation in this install has any content");
	if (found) {
		// The answer is at the end, so that is where a conversation opens; a short transcript
		// that does not scroll is trivially at its end.
		const atEnd = await page.evaluate(() => {
			const element = document.querySelector("[data-slot=transcript]");
			if (element === null) return { ok: true, note: "no transcript" };
			const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
			return {
				ok: element.scrollHeight <= element.clientHeight + 8 || distance < 120,
				note: `${Math.round(distance)}px from the end`,
			};
		});
		check("the transcript opens at its end", atEnd.ok, atEnd.note);

		const squashed = await page.evaluate(
			(selector) =>
				[...document.querySelectorAll(selector)]
					.filter((item) => item.getBoundingClientRect().height < 8)
					.map((item) => `${item.dataset.slot}: ${Math.round(item.getBoundingClientRect().height)}px`),
			PANES,
		);
		check("no transcript item is squashed", squashed.length === 0, squashed.join(", "));

		const rendered = await page.evaluate(
			() =>
				document.querySelectorAll(
					"[data-slot=transcript] .markdown p, [data-slot=transcript] .markdown li, [data-slot=transcript] .markdown pre",
				).length,
		);
		check("the transcript renders its markdown", rendered > 0, "no rendered markdown on screen");

		const clipped = await page.evaluate(() =>
			[...document.querySelectorAll("[data-slot=tool]")].map((card) => ({
				card: Math.round(card.getBoundingClientRect().height),
				output:
					card.querySelector("pre") === null
						? 0
						: Math.round(card.querySelector("pre").getBoundingClientRect().height),
			})),
		);
		check(
			"tool cards are at least as tall as their output",
			clipped.every((item) => item.output <= 8 || item.card >= item.output),
			JSON.stringify(clipped),
		);

		// 4. Controls are per pane: copy on every rendered reply and tool card, a format toggle
		// on assistant replies only. Two kinds of pane are the exception on purpose: a live pane
		// (its text is incomplete) and a failure pane (there is nothing to toggle or copy).
		const controls = await page.evaluate(() =>
			[
				...document.querySelectorAll(
					"[data-slot=assistant]:not([data-live]):not([data-error]), [data-slot=tool]",
				),
			].map((pane) => {
				const labels = [...pane.querySelectorAll("button")].map((button) => button.textContent?.trim());
				return {
					slot: pane.dataset.slot,
					copy: labels.includes("Copy"),
					format: labels.some((label) => label === "Raw" || label === "Formatted"),
				};
			}),
		);
		check("every pane carries a copy button", controls.length > 0 && controls.every((p) => p.copy), JSON.stringify(controls));
		check(
			"assistant panes offer a format toggle",
			controls.filter((p) => p.slot === "assistant").every((p) => p.format),
			JSON.stringify(controls),
		);
		check(
			"tool panes do not offer a format toggle",
			controls.filter((p) => p.slot === "tool").every((p) => !p.format),
			JSON.stringify(controls),
		);

		const paneState = () =>
			page.evaluate(() =>
				[...document.querySelectorAll("[data-slot=assistant]:not([data-live]):not([data-error])")].map(
					(pane) => ({
						raw: pane.querySelector(".markdown") === null,
						label:
							[...pane.querySelectorAll("button")]
								.map((b) => b.textContent?.trim())
								.find((label) => label === "Raw" || label === "Formatted") ?? "",
					}),
				),
			);
		const clickToggle = (label) =>
			page.evaluate((wanted) => {
				for (const pane of document.querySelectorAll("[data-slot=assistant]")) {
					const button = [...pane.querySelectorAll("button")].find((b) => b.textContent?.trim() === wanted);
					if (button !== undefined) {
						button.click();
						return true;
					}
				}
				return false;
			}, label);

		const before = await paneState();
		if (before.length > 0 && (await clickToggle("Raw"))) {
			const after = await paneState();
			check("toggling a pane makes that pane raw", after[0]?.raw === true && after[0]?.label === "Formatted", JSON.stringify(after));
			check(
				"toggling one pane leaves the others alone",
				JSON.stringify(after.slice(1)) === JSON.stringify(before.slice(1)),
				`${JSON.stringify(before)} → ${JSON.stringify(after)}`,
			);
			await clickToggle("Formatted");
			const restored = await paneState();
			check("toggling back restores that pane only", JSON.stringify(restored) === JSON.stringify(before), JSON.stringify(restored));
		}
	}

	// 4. The theme: the system decides until someone says otherwise, and a choice is remembered.
	const isDark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));

	await page.evaluate(() => localStorage.removeItem("acornfall.ui.theme"));
	await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.waitForSelector("[data-slot=conversation-list]", { timeout: 15000 });
	check("with no choice made, a dark system gets the dark theme", await isDark(), "came up light");

	await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.waitForSelector("[data-slot=conversation-list]", { timeout: 15000 });
	check("a light system gets the light theme", !(await isDark()), "came up dark");

	const themeButton = await page.$("button[aria-label^='Switch to the']");
	check("the theme toggle is on screen", themeButton !== null);
	if (themeButton !== null) {
		await themeButton.click();
		check("the toggle overrides the system", await isDark(), "the click did not darken the page");
		// The system still says light; the explicit choice still wins.
		await page.reload({ waitUntil: "domcontentloaded" });
		await page.waitForSelector("[data-slot=conversation-list]", { timeout: 15000 });
		check(
			"an explicit choice survives a reload even against the system",
			await isDark(),
			"the reload forgot the choice",
		);
	}

	// 5. The composer says what it will run and where each value came from, and a slash
	// offers the commands the server would expand.
	const pickers = await page.evaluate(() =>
		["Model", "Thinking", "Agent"].map((label) => {
			const button = document.querySelector(`[data-slot=composer] button[aria-label="${label}"]`);
			return button?.textContent?.trim().replace(/\s+/g, " ") ?? "";
		}),
	);
	check(
		"the composer carries a model, thinking, and agent choice",
		pickers.every((text) => text.includes(":")),
		JSON.stringify(pickers),
	);
	check(
		"a resolved choice says which layer it came from",
		pickers.some((text) => text.includes("·")),
		JSON.stringify(pickers),
	);

	const commandCount = await page.evaluate(async () => {
		const body = await (await fetch("/api/workspaces/general/commands")).json();
		return (body.commands ?? []).length;
	});
	if (commandCount > 0) {
		await page.click("[data-slot=composer] textarea");
		await page.type("[data-slot=composer] textarea", "/");
		const offered = await page
			.waitForSelector("[data-slot=slash-menu]", { timeout: 5000 })
			.then(() => true)
			.catch(() => false);
		check("a slash offers the commands the server would expand", offered);
		await page.keyboard.down("Control");
		await page.keyboard.press("KeyA");
		await page.keyboard.up("Control");
		await page.keyboard.press("Backspace");
	}

	// 6. The phone gets the transcript, not a rail eating it; the drawer is how the rail opens.
	await page.setViewport({ width: 390, height: 844 });
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.waitForSelector("[data-slot=conversation-list]", { timeout: 15000 });
	const desktopRailWidth = await railWidth();
	check("the rail is not in the phone's layout", desktopRailWidth === 0, `${desktopRailWidth}px`);
	const toggle = await page.$("button[aria-label='Conversations']");
	check("the rail toggle is on the phone", toggle !== null);
	if (toggle !== null) {
		await toggle.click();
		await page.waitForSelector("[role=dialog]", { timeout: 5000 });
		const drawerHasRail = await page.evaluate(
			() => document.querySelector("[role=dialog] [data-slot=conversation-list]") !== null,
		);
		check("the toggle opens the rail in a drawer", drawerHasRail);
		const drawerWidth = await page.evaluate(() => ({
			drawer: Math.round(document.querySelector("[role=dialog]")?.getBoundingClientRect().width ?? 0),
			window: window.innerWidth,
		}));
		check(
			"the drawer takes the phone's width",
			Math.abs(drawerWidth.drawer - drawerWidth.window) <= 1,
			`${drawerWidth.drawer}px of ${drawerWidth.window}px`,
		);
		await page.keyboard.press("Escape");
		await page.waitForFunction(() => document.querySelector("[role=dialog]") === null, { timeout: 5000 });
		check("the drawer closes", true);
	}

	// The composer's controls have to fit a phone: wrapping is fine, running past the edge is
	// the bug this check exists for.
	const controlOverflow = await page.evaluate(() => {
		const composer = document.querySelector("[data-slot=composer]");
		if (composer === null) return -1;
		const box = composer.getBoundingClientRect();
		return [...composer.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().right > box.right + 1)
			.length;
	});
	check("nothing in the composer runs past the phone's edge", controlOverflow === 0, `${controlOverflow} elements`);

	check("no JavaScript errors", problems.length === 0, problems.join("; "));
} finally {
	await browser.close();
}

if (failures.length > 0) {
	console.error(`ui check failed (${passed} passed):\n  - ${failures.join("\n  - ")}`);
	process.exit(1);
}
console.log(`ui check ok: ${passed} checks passed`);
