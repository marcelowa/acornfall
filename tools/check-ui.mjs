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

	// 2. The transcript renders, and nothing in it is squashed or clipped.
	const found = await showConversationWithContent(page);
	check("a conversation with content is on screen", found, "no conversation in this install has any content");
	if (found) {
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

		// 3. Controls are per pane: copy everywhere, a format toggle on assistant panes only.
		const controls = await page.evaluate(() =>
			[...document.querySelectorAll("[data-slot=assistant], [data-slot=tool]")].map((pane) => {
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
				[...document.querySelectorAll("[data-slot=assistant]")].map((pane) => ({
					raw: pane.querySelector(".markdown") === null,
					label:
						[...pane.querySelectorAll("button")]
							.map((b) => b.textContent?.trim())
							.find((label) => label === "Raw" || label === "Formatted") ?? "",
				})),
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

	// 4. The theme is a click that survives a reload.
	const themeButton = await page.$("button[aria-label^='Switch to the']");
	check("the theme toggle is on screen", themeButton !== null);
	if (themeButton !== null) {
		await themeButton.click();
		const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
		check("the toggle switches the theme", dark, "html has no dark class after the click");
		await page.reload({ waitUntil: "domcontentloaded" });
		await page.waitForSelector("[data-slot=conversation-list]", { timeout: 15000 });
		const stillDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
		check("the theme survives a reload", stillDark, "the reload came back light");
		await page.click("button[aria-label^='Switch to the']");
	}

	// 5. The phone gets the transcript, not a rail eating it; the drawer is how the rail opens.
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
		await page.keyboard.press("Escape");
		await page.waitForFunction(() => document.querySelector("[role=dialog]") === null, { timeout: 5000 });
		check("the drawer closes", true);
	}

	check("no JavaScript errors", problems.length === 0, problems.join("; "));
} finally {
	await browser.close();
}

if (failures.length > 0) {
	console.error(`ui check failed (${passed} passed):\n  - ${failures.join("\n  - ")}`);
	process.exit(1);
}
console.log(`ui check ok: ${passed} checks passed`);
