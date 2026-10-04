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

	// 4. The settings sheet holds providers and defaults, and closes.
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
