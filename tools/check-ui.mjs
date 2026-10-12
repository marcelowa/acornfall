// The interface's browser suite: the behaviours a curl cannot see. It drives the built client
// the gateway serves, and it keeps the failures this file was written for — a splitter that
// does not persist, transcript items a flex column squashed to nothing, tool cards that clip
// their own output, pane controls that are not per-pane, a rail that eats a phone's width.
//
// Markdown parsing and sanitising are unit tests in `ui/test/render-markdown.test.ts`: they
// need a DOM, not a browser, and the host parser is the thing that varies. This suite only
// has to prove the pane renders through the real bundle.
//
// The inspector's overlay is not here yet; it arrives with #13, and the assertions that
// covered the old client's version of it belong there.
//
// Needs a gateway on --addr; run with: bun run tools/check-ui.mjs [url]
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? process.env.ACORNFALL_URL ?? "http://127.0.0.1:7777";
const chrome = process.env.CHROME_PATH ?? "/usr/bin/chromium";

let passed = 0;
const failures = [];
/**
 * One check. `UI_CHECK_TRACE=1` also prints it as it runs: a run that stops on a crash says
 * nothing about how far it got otherwise. The failure list at the end is unchanged.
 */
const check = (label, ok, detail) => {
	if (process.env.UI_CHECK_TRACE === "1") console.error((ok ? "ok   " : "FAIL ") + label);
	if (ok) {
		passed += 1;
		return;
	}
	failures.push(`${label}${detail === undefined ? "" : `: ${detail}`}`);
};

/**
 * Click through the page's own DOM. A mouse dispatch on an element a re-render can replace
 * mid-click hangs the protocol, and the clicks here navigate, which re-renders everything.
 */
async function inPage(page, fn, arg) {
	// A navigation replaces the execution context, and an evaluate caught in that window comes
	// back as "Promise was collected" rather than as an answer. Retrying is honest: the call
	// is a question about the page, and the page is still there to be asked.
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			return await page.evaluate(fn, arg);
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}
	return undefined;
}

/** Click through the page's own DOM: a mouse dispatch on an element a re-render replaces
 * mid-click hangs the protocol, and the clicks here navigate, which re-renders everything. */
async function press(page, selector) {
	const found = await inPage(page, (wanted) => {
		const element = document.querySelector(wanted);
		element?.click();
		return element !== null;
	}, selector);
	return found === true;
}

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
	// Ask the server which conversation has something to show, then wait for the rail to have
	// its row: the list is the app's, and it is not the same instant as the answer.
	const target =
		(await inPage(page, async () => {
			const rows = await (await fetch("/api/workspaces/general/conversations")).json();
			const withContent = (rows ?? []).find(
				(row) => !row.hidden && row.parent === undefined && row.lastEntryId !== "",
			);
			return withContent?.id ?? "";
		})) ?? "";
	if (target === "") return false;
	const row = `[data-slot=conversation-select][data-conversation="${target}"]`;
	const rendered = await page
		.waitForSelector(row, { timeout: 10000 })
		.then(() => true)
		.catch(() => false);
	if (!rendered) return false;
	await press(page, row);
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
	// The app asks before renaming, and a modal dialog blocks the renderer: a stray click on
	// Rename would otherwise wedge the whole run, close included.
	page.on("dialog", (dialog) => void dialog.dismiss());
	await page.setViewport({ width: 1400, height: 900 });

	const problems = [];
	page.on("console", (message) => {
		if (message.type() !== "error") return;
		// The suite asks the server for one refusal on purpose (a workspace name that is a
		// path). The browser logs the 409; the app shows it in the error strip.
		if (/Failed to load resource.*409/.test(message.text())) return;
		problems.push(`console: ${message.text()}`);
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
	check(
		"nothing announces a healthy connection",
		await page.evaluate(() => document.querySelector("[data-slot=status-pill]") === null),
	);

	// The rail's top button names the workspace in view and opens the screen that changes it.
	const workspaceButton = await page.$("button[aria-label='Workspaces']");
	check("the rail names the workspace on top", workspaceButton !== null);
	const workspaceState = await page.evaluate(async () => {
		const state = await (await fetch("/api/state")).json();
		return {
			active: state.workspace.name,
			title: (state.workspaces ?? []).find((item) => item.active)?.title ?? "",
			count: (state.workspaces ?? []).length,
		};
	});
	const buttonText =
		workspaceButton === null ? "" : await workspaceButton.evaluate((element) => element.textContent ?? "");
	check(
		"the button says which workspace this is",
		buttonText.includes(workspaceState.title),
		buttonText.trim(),
	);

	if (workspaceButton !== null) {
		await press(page, "button[aria-label='Workspaces']");
		await page.waitForFunction(() => window.location.pathname === "/workspaces", {
			timeout: 10000,
		});
		const rows = await page.evaluate(() =>
			[...document.querySelectorAll("[data-slot=workspaces-screen] [data-slot=workspace-row]")].map(
				(row) => ({
					name: row.getAttribute("data-name"),
					active: row.getAttribute("data-active") === "true",
				}),
			),
		);
		check(
			"the workspace button opens the workspaces screen",
			rows.length === workspaceState.count,
			`${rows.length} rows, ${workspaceState.count} workspaces`,
		);
		check(
			"the screen marks the workspace in view",
			rows.find((row) => row.active)?.name === workspaceState.active,
			JSON.stringify(rows),
		);
		// The conversation is behind the screen, not gone: the rail is still the way back.
		check(
			"the rail stays while a screen is open",
			(await page.$("[data-slot=conversation-list]")) !== null,
		);

		const otherWorkspace = rows.find((row) => !row.active)?.name ?? "";
		if (otherWorkspace !== "") {
			await press(page, `[data-slot=workspace-row][data-name="${otherWorkspace}"] button[aria-label^='Open ']`);
			await page.waitForFunction(
				(name) => window.location.pathname === `/w/${name}`,
				{ timeout: 15000 },
				otherWorkspace,
			);
			// Opening a workspace leaves the screen: it lands on that workspace's conversation.
			const landed = await page
				.waitForSelector("[data-slot=composer]", { timeout: 15000 })
				.then(() => true)
				.catch(() => false);
			check(
				"opening a workspace lands on it, out of the screen",
				landed &&
					(await page.evaluate(() => document.querySelector("[data-slot=workspaces-screen]") === null)),
			);
			// Back where it started, so the rest of the suite runs against the same workspace.
			await press(page, "button[aria-label='Workspaces']");
			await page.waitForFunction(() => window.location.pathname === "/workspaces", {
				timeout: 10000,
			});
			// The row offers Open only once the state says this workspace is the one in view;
			// waiting for it is waiting for the fetch, not for a timer.
			await page.waitForSelector(
				`[data-slot=workspace-row][data-name="${workspaceState.active}"] button[aria-label^='Open ']`,
				{ timeout: 15000 },
			);
			await press(
				page,
				`[data-slot=workspace-row][data-name="${workspaceState.active}"] button[aria-label^='Open ']`,
			);
			await page.waitForFunction(
				(name) => window.location.pathname === `/w/${name}`,
				{ timeout: 15000 },
				workspaceState.active,
			);
			await page.waitForSelector("[data-slot=conversation-list]", { timeout: 15000 });
		}
	}

	// The settings screen: the theme, the workspace in view, and what its defaults resolve to.
	// It is a screen rather than a sheet, so the conversation stays behind it and the rail is
	// how you leave and how you come back.
	const settingsTrigger = await page.$("button[aria-label='Settings']");
	check("the settings trigger is in the rail", settingsTrigger !== null);
	check(
		"no screen is over the conversation to start with",
		await page.evaluate(() => document.querySelector("[data-slot=settings-screen]") === null),
	);
	if (settingsTrigger !== null) {
		await press(page, "button[aria-label='Settings']");
		await page.waitForSelector("[data-slot=settings-screen]", { timeout: 5000 });
		// Each page has its own URL, so this is /settings/<page> rather than a bare /settings.
		check(
			"settings has a URL of its own",
			await page.evaluate(() => window.location.pathname.startsWith("/settings")),
		);
		const settingsText = await page.evaluate(
			() => document.querySelector("[data-slot=settings-screen]")?.textContent ?? "",
		);
		check("settings shows the defaults", settingsText.includes("Defaults"));
		// The sandbox fields left this screen: a workspace names itself on the workspaces screen,
		// and the row menu opens them there. So this screen has three pages, and the theme is a
		// group on the first one rather than a tab of its own.
		check(
			"settings has three pages, and no workspace tab",
			settingsText.includes("Providers") &&
				settingsText.includes("Updates") &&
				!settingsText.includes("Workspace\n"),
			settingsText.replace(/\s+/g, " ").slice(0, 80),
		);
		check(
			"the defaults have a tab per scope",
			settingsText.includes("This workspace") && settingsText.includes("Global"),
			settingsText.slice(0, 80),
		);
		check(
			"settings offers light, dark, and system",
			["Light", "Dark", "System"].every((label) => settingsText.includes(label)),
		);
		check(
			"settings keeps the composer out of the way",
			(await page.$("[data-slot=composer]")) === null,
		);

		// A refused action shows the server's own sentence, until it is dismissed — and it does
		// so on a screen too, which is why the strip sits in the shell and not in the composer.
		await press(page, "button[aria-label='Back to the conversation']");
		await page.waitForSelector("[data-slot=composer]", { timeout: 5000 });
		await press(page, "button[aria-label='Workspaces']");
		await page.waitForSelector("[data-slot=workspaces-screen]", { timeout: 5000 });
		await page.type("[data-slot=workspaces-create] input", "ui-check/refused");
		const created = await page.evaluate(() => {
			const create = [...document.querySelectorAll("[data-slot=workspaces-create] button")].find(
				(button) => button.textContent?.trim() === "Create",
			);
			create?.click();
			return create !== undefined;
		});
		check("the create form has a Create button", created);
		const strip = await page
			.waitForSelector("[data-slot=error-strip]", { timeout: 10000 })
			.catch(() => null);
		const stripText =
			strip === null ? "" : await strip.evaluate((element) => element.textContent ?? "");
		check(
			"a refused action shows the server's words",
			stripText.includes("cannot contain a slash"),
			stripText.replace(/\s+/g, " ").slice(0, 90),
		);
		check(
			"a refused action can be asked again",
			strip === null
				? false
				: await strip.evaluate(
					(element) =>
						element.querySelector("button:not([aria-label='Dismiss the error'])") !==
						null,
					),
		);
		if (strip !== null) {
			await strip.evaluate((element) =>
				element.querySelector("button[aria-label='Dismiss the error']")?.click(),
			);
			const dismissed = await page.evaluate(
				() => document.querySelector("[data-slot=error-strip]") === null,
			);
			check("the error strip can be dismissed", dismissed);
		}

		const activePath = await page.evaluate(async () => {
			const state = await (await fetch("/api/state")).json();
			return state.workspace.path ?? "";
		});

		// The sandbox fields live behind a workspaces row now, not on the settings screen: the
		// row names the workspace, so this is where its image and network are set.
		const rowActions = await page.$(
			"[data-slot=workspace-row][data-active=true] button[aria-label^=\"Actions for\"]",
		);
		check("a workspace row offers its actions from a menu", rowActions !== null);
		if (rowActions !== null) {
			await page.hover("[data-slot=workspace-row][data-active=true]");
			await rowActions.click();
			await page.waitForSelector("[role=menu]", { timeout: 5000 });
			await page.evaluate(() => {
				const item = [...document.querySelectorAll("[role=menu] [role=menuitem]")].find((one) =>
					one.textContent?.includes("Sandbox"),
				);
				item?.setAttribute("data-ui-check", "sandbox");
			});
			const offered = await page.evaluate(
				() => document.querySelector("[data-ui-check=sandbox]") !== null,
			);
			check("the row menu offers the sandbox", offered);
			if (offered) {
				await page.click("[data-ui-check=sandbox]");
				const dialog = await page
					.waitForSelector("[role=dialog]", { timeout: 5000 })
					.catch(() => null);
				const dialogText =
					dialog === null
						? ""
						: await dialog.evaluate((element) => element.textContent ?? "");
				check(
					"the sandbox dialog says where the workspace points",
					activePath !== "" && dialogText.includes(activePath),
					dialogText.replace(/\s+/g, " ").slice(0, 80),
				);
				check(
					"the sandbox dialog sets an image and a network",
					dialogText.includes("image") && dialogText.includes("network"),
				);
				await page.keyboard.press("Escape");
			}
		}

		// Creating a workspace for real, which is the one flow here that leaves something
		// behind. It is created, it has to open on a conversation the gateway made for it, and
		// then it is forgotten. Forgetting keeps a workspace's state on purpose, and the
		// sandbox manager writes that folder while tearing the sandbox down — so this leaves
		// one directory behind, and the next run's cleanup at the top of this block is what
		// removes it. A fixed name keeps that to one directory rather than one per run.
		const scratch = "ui-check";
		const workspacesDir = await page.evaluate(
			async () => (await (await fetch("/api/state")).json()).workspacesDir ?? "",
		);
		const litter = [
			join(workspacesDir, scratch),
			join(dirname(workspacesDir), "state", scratch),
		];
		for (const path of litter) rmSync(path, { recursive: true, force: true });

		await page.type("[data-slot=workspaces-create] input", scratch);
		await press(page, "[data-slot=workspaces-create] button");
		const opened = await page
			.waitForFunction(
				(name) =>
					window.location.pathname === `/w/${name}` ||
					window.location.pathname.startsWith(`/c/${name}/`),
				{ timeout: 20000 },
				scratch,
			)
			.then(() => true)
			.catch(() => false);
		check("creating a workspace opens it on a conversation", opened, scratch);
		const fresh = await page.evaluate(async (name) => {
			const state = await (await fetch(`/api/workspaces/${name}/state`)).json();
			return {
				active: state.conversation?.id ?? "",
				conversations: (state.conversations ?? []).length,
			};
		}, scratch);
		check(
			"a new workspace opens on one conversation of its own",
			fresh.active !== "" && fresh.conversations === 1,
			JSON.stringify(fresh),
		);

		// Back to the workspace the rest of the suite runs in, before the scratch one goes
		// away: a tab pointed at a removed workspace has nothing to show.
		await press(page, "button[aria-label='Workspaces']");
		await page.waitForSelector("[data-slot=workspaces-screen]", { timeout: 5000 });
		await press(
			page,
			`[data-slot=workspace-row][data-name="${workspaceState.active}"] button[aria-label^='Open ']`,
		);
		const returned = await page
			.waitForFunction(
				(name) =>
					window.location.pathname === `/w/${name}` ||
					window.location.pathname.startsWith(`/c/${name}/`),
				{ timeout: 20000 },
				workspaceState.active,
			)
			.then(() => true)
			.catch(() => false);
		check("the workspace in view is reachable again", returned, workspaceState.active);

		await page.evaluate(async (name) => {
			await fetch(`/api/workspaces/${name}/remove`, { method: "POST" });
		}, scratch);
		for (const path of litter) rmSync(path, { recursive: true, force: true });

		await press(page, "button[aria-label='Back to the conversation']");
		await page.waitForSelector("[data-slot=composer]", { timeout: 5000 });
	}

	// The bottom of the rail: a new conversation is created and opened, not a button that
	// leaves you looking at an empty screen. It is tombstoned afterwards, so a suite run does
	// not leave a trail of empty conversations behind it.
	const beforeNew = await page.evaluate(() => window.location.pathname);
	check(
		"the rail offers a new conversation",
		(await page.$("button[aria-label='New conversation']")) !== null,
	);
	if (await press(page, "button[aria-label='New conversation']")) {
		const opened = await page
			.waitForFunction(
				(previous) =>
					window.location.pathname.startsWith("/c/") &&
					window.location.pathname !== previous,
				{ timeout: 15000 },
				beforeNew,
			)
			.then(() => true)
			.catch(() => false);
		check("a new conversation is created and opened", opened, beforeNew);
		const created = await page.evaluate(async () => {
			const state = await (await fetch("/api/state")).json();
			return state.conversation?.id ?? "";
		});
		check("the new conversation is the one in view", created !== "", created);
		if (created !== "") {
			await page.evaluate(async (id) => {
				await fetch(`/api/workspaces/general/conversations/${id}/hide`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ hidden: true }),
				});
			}, created);
		}
	}

	// 2. The rail is a pane, not the page: the conversations scroll between the workspace button
	// and the bottom zone, which stays visible, and the document itself never grows — a page that
	// scrolls moves every panel, including the ones that were meant to stay put. The earlier
	// version of this check passed while the rail was broken: it only asked whether an overflow
	// that scrolled was set to scroll, which a list that never scrolled also satisfies.
	const rail = await page.evaluate(() => {
		const aside = document.querySelector("aside");
		const list = document.querySelector("[data-slot=conversation-list]");
		const settings = document.querySelector("button[aria-label='Settings']");
		const workspaces = document.querySelector("button[aria-label='Workspaces']");
		const toggle = document.querySelector("button[aria-label='Hide the rail']");
		if (aside === null || list === null || settings === null || workspaces === null) return null;
		const box = (element) => {
			const rect = element.getBoundingClientRect();
			return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
		};
		const chevron = [...workspaces.querySelectorAll("svg")].at(-1) ?? workspaces;
		const overlaps = (a, b) =>
			a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
		return {
			rail: box(aside),
			list: box(list),
			settings: box(settings),
			workspaces: box(workspaces),
			chevron: box(chevron),
			toggle: toggle === null ? null : box(toggle),
			overflowY: getComputedStyle(list).overflowY,
			scrolls: list.scrollHeight > list.clientHeight + 1,
			documentScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
			windowHeight: window.innerHeight,
		};
	});
	check("the rail has a workspace button, a list, and a bottom zone", rail !== null);
	if (rail !== null) {
		check(
			"the bottom of the rail stays inside the pane",
			rail.settings.bottom <= rail.rail.bottom + 1 && rail.settings.top >= rail.rail.top,
			`settings ends at ${Math.round(rail.settings.bottom)}, rail at ${Math.round(rail.rail.bottom)}`,
		);
		check(
			"the conversations stop where the bottom zone starts",
			rail.list.bottom <= rail.settings.top + 1,
			`list ends at ${Math.round(rail.list.bottom)}, settings start at ${Math.round(rail.settings.top)}`,
		);
		check(
			"a long list scrolls rather than pushing the bottom out",
			!rail.scrolls || rail.overflowY === "auto",
			`${rail.scrolls ? "scrolls" : "fits"}, overflow-y: ${rail.overflowY}`,
		);
		check(
			"the page itself does not scroll",
			!rail.documentScrolls,
			`${Math.round(rail.rail.bottom)}px of rail in a ${rail.windowHeight}px window`,
		);
		if (rail.toggle !== null) {
			check(
				"the workspace button's chevron clears the rail's own toggle",
				rail.chevron.right <= rail.toggle.left + 1,
				`chevron ends at ${Math.round(rail.chevron.right)}, toggle starts at ${Math.round(rail.toggle.left)}`,
			);
		}
	}

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
		const collapsedWidth = await railWidth();
		check(
			"hiding the rail leaves a strip with the way back",
			collapsedWidth > 0 && collapsedWidth <= 48,
			`${collapsedWidth}px`,
		);
		await page.reload({ waitUntil: "domcontentloaded" });
		await page.waitForSelector("[data-slot=composer]", { timeout: 15000 });
		const stillCollapsed = await railWidth();
		check(
			"the rail stays collapsed after a reload",
			stillCollapsed > 0 && stillCollapsed <= 48,
			`${stillCollapsed}px`,
		);
		const showRail = await page.$("button[aria-label='Show the rail']");
		if (showRail !== null) {
			await showRail.click();
			const back = await railWidth();
			check("the rail comes back", back > 200, `${back}px`);
		}
	}

	// A row's actions are a menu, because a hover does not exist on a touch screen. The `…`
	// button and a right-click ask the same question.
	const rowActions = await page.$("[data-slot=conversation-row] button[aria-label^='Actions']");
	check("a row offers its actions from a menu", rowActions !== null);
	if (rowActions !== null) {
		await page.hover("[data-slot=conversation-row]");
		await rowActions.click();
		await page.waitForSelector('[role="menu"]', { timeout: 5000 });
		const labels = await page.evaluate(() =>
			[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((item) =>
				item.textContent?.trim(),
			),
		);
		check(
			"the row menu offers rename and delete",
			labels.includes("Rename") && labels.includes("Delete"),
			JSON.stringify(labels),
		);
		await page.keyboard.press("Escape");
		await page.click("[data-slot=conversation-row]", { button: "right" });
		const opened = await page
			.waitForSelector('[role="menu"]', { timeout: 5000 })
			.then(() => true)
			.catch(() => false);
		check("a right-click opens the same menu", opened);
		await page.keyboard.press("Escape");
	}

	// A fresh install has no transcript, and this section is about one, so it makes one: the
	// scripted dev provider answers a message with a tool call and a reply, which is the
	// content the checks below are written for. The workspace and conversation come from the
	// page's own URL, which is the app's answer to "where am I" — a fresh install has no
	// workspace in flight for /api/state to resolve.
	const seeded = await page
		.evaluate(async () => {
			try {
				const match = /^\/c\/([^/]+)\/([^/]+)/.exec(window.location.pathname);
				if (match === null) return false;
				const url =
					"/api/workspaces/" +
					match[1] +
					"/conversations/" +
					match[2] +
					"/messages";
				const response = await fetch(url, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ text: "list the workspace", whenBusy: "followUp" }),
				});
				return response.ok;
			} catch {
				return false;
			}
		})
		.catch(() => false);
	check("a turn can be started for the transcript checks", seeded);
	if (seeded) {
		// Both halves of the turn: the tool call, and the answer once it has settled — a live
		// answer renders as plain text, and the checks below are about rendered markdown.
		await page
			.waitForFunction(
				() =>
					document.querySelector("[data-slot=transcript] [data-slot=tool]") !== null &&
					document.querySelector(
						"[data-slot=transcript] [data-slot=assistant]:not([data-live])",
					) !== null,
				{ timeout: 90000 },
			)
			.catch(() => undefined);
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

	// 4. The theme: the system decides until someone chooses, and the choice is made in settings
	// and remembered there. Three options, so following the system is a choice too.
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

	const chooseTheme = (label) =>
		page.evaluate((wanted) => {
			const button = [...document.querySelectorAll("[data-slot=settings-theme] button")].find(
				(element) => element.textContent?.trim() === wanted,
			);
			button?.click();
			return button !== undefined;
		}, label);

	await press(page, "button[aria-label='Settings']");
	await page.waitForSelector("[data-slot=settings-screen]", { timeout: 5000 });
	check("the settings screen has a Dark choice", await chooseTheme("Dark"));
	// The system still says light; the explicit choice still wins.
	check("choosing dark overrides the system", await isDark(), "the click did not darken the page");
	await page.reload({ waitUntil: "domcontentloaded" });
	await page.waitForSelector("[data-slot=settings-screen]", { timeout: 15000 });
	check(
		"an explicit choice survives a reload even against the system",
		await isDark(),
		"the reload forgot the choice",
	);
	check("the settings screen still has a System choice", await chooseTheme("System"));
	check("choosing system follows the machine again", !(await isDark()), "stayed dark");
	await press(page, "button[aria-label='Back to the conversation']");
	await page.waitForSelector("[data-slot=composer]", { timeout: 5000 });

	// 5. The composer says what it will run in one line, and the layers are one click away. A
	// slash offers the commands the server would expand.
	//
	// Selecting a conversation from the rail is what tells the harness about it, so this picks
	// one first: a summary that reads "not set" for the conversation in view is the bug this
	// part of the check exists for.
	const target =
		(await inPage(page, async () => {
			const rows = await (await fetch("/api/workspaces/general/conversations")).json();
			const row = (rows ?? []).find(
				(candidate) => !candidate.hidden && candidate.parent === undefined,
			);
			return row?.id ?? "";
		})) ?? "";
	const targetRow = `[data-slot=conversation-select][data-conversation="${target}"]`;
	const selectable =
		target !== "" &&
		(await page
			.waitForSelector(targetRow, { timeout: 10000 })
			.then(() => true)
			.catch(() => false));
	if (selectable) await press(page, targetRow);
	check("a conversation can be selected from the rail", selectable, target);
	const settled = await page
		.waitForFunction(
			async () => {
				const state = await (await fetch("/api/state")).json();
				const name = state.resolved?.name ?? "";
				const text =
					document.querySelector("[data-slot=composer] [data-slot=choice-control]")
						?.textContent ?? "";
				return name !== "" && text.includes(name);
			},
			{ timeout: 15000 },
		)
		.then(() => true)
		.catch(() => false);
	check("the conversation in view resolves its agent", settled, target);

	const summary = await page.evaluate(
		() =>
			document
				.querySelector("[data-slot=composer] [data-slot=choice-control]")
				?.textContent?.trim()
				.replace(/\s+/g, " ") ?? "",
	);
	const wire = await page.evaluate(async () => {
		const body = await (await fetch("/api/state")).json();
		return {
			model: body.agent?.modelId ?? "",
			thinking: body.agent?.thinkingLevel ?? "",
			agent: body.resolved?.name ?? "",
		};
	});
	// The model shows its display name and the other two show their values, so the check is
	// that the three are there and that the two it can name exactly are in the right places. A
	// note can follow them — a subagent's agent, a level that was clamped — which is why the
	// count is a floor rather than an equality.
	const parts = summary.split("·").map((part) => part.trim());
	check(
		"the composer says what runs this conversation in one line",
		parts.length >= 3 && parts.slice(0, 3).every((part) => part !== "") && wire.model !== "",
		`"${summary}"`,
	);
	// An unset level is shown as "not set" rather than as nothing, so the check is against
	// what the interface says, not against the empty string the wire carries.
	const thinkingShown = wire.thinking === "" ? "not set" : wire.thinking;
	check(
		"the line reads agent, model, thinking",
		parts[0] === wire.agent && parts[2] === thinkingShown,
		`"${summary}" for ${wire.agent} … ${thinkingShown}`,
	);
	// Long names truncate inside a fixed line: the control never outgrows the screen.
	const pastEdge = await page.evaluate(() => {
		const box = document
			.querySelector("[data-slot=composer] [data-slot=choice-control]")
			?.getBoundingClientRect();
		return box === undefined ? 0 : box.right - window.innerWidth;
	});
	check("the choice line stays inside the screen", pastEdge <= 1, `${pastEdge}px past`);

	const opened = await press(page, "[data-slot=composer] [data-slot=choice-control]");
	const panel = await page
		.waitForSelector("[data-slot=popover-content]", { timeout: 5000 })
		.catch(() => null);
	check("the control opens the three choices", opened && panel !== null);
	if (panel !== null) {
		const inside = await page.evaluate(() =>
			["Agent", "Model", "Thinking"].map(
				(label) =>
					document
						.querySelector(
							`[data-slot=popover-content] button[aria-label="${label}"]`,
						)
						?.textContent?.trim()
						.replace(/\s+/g, " ") ?? "",
			),
		);
		// Each choice is labelled once, by prefix, and shows a value: counting the word again
		// would fail on a value that contains it — the model here is called "Faux Model".
		check(
			"the panel is the three choices, each labelled once",
			inside.every((text, index) => {
				const label = ["Agent", "Model", "Thinking"][index];
				return text.startsWith(`${label}:`) && text.slice(label.length + 1).trim() !== "";
			}),
			JSON.stringify(inside),
		);
		check(
			"each choice shows its value rather than its layer",
			inside.every((text) => !text.includes("this conversation")),
			JSON.stringify(inside),
		);
		await page.keyboard.press("Escape");
		await page.waitForFunction(
			() => document.querySelector("[data-slot=popover-content]") === null,
			{ timeout: 5000 },
		);
		check("the panel closes", true);
	}

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

	// 7. The inspector: an overlay behind the header toggle in the top-right corner, closed
	// by default, and not remembered — opening it is a question asked now, not a preference.
	await page.setViewport({ width: 1400, height: 900 });
	// The toggle exists twice — the desktop header and the small-screen bar, one hidden —
	// so the suite asks for the one a reader can see.
	const visibleToggleBox = () =>
		inPage(page, () => {
			const element = [...document.querySelectorAll("[data-slot=inspector-toggle]")].find(
				(candidate) => candidate.getClientRects().length > 0,
			);
			if (element === undefined) return null;
			const box = element.getBoundingClientRect();
			return {
				fromTop: box.top,
				fromRight: window.innerWidth - box.right,
				bottom: box.bottom,
			};
		});
	const pressVisibleToggle = () =>
		inPage(page, () => {
			[...document.querySelectorAll("[data-slot=inspector-toggle]")
			].find((candidate) => candidate.getClientRects().length > 0)?.click();
		});
	const corner = await visibleToggleBox();
	check("the inspector has a toggle in the corner", corner !== null);
	if (corner !== null) {
		check(
			"the toggle sits in the top-right corner",
			corner.fromTop < 40 && corner.fromRight < 40,
			`${Math.round(corner.fromTop)}px from the top, ${Math.round(corner.fromRight)}px from the right`,
		);
		check(
			"the inspector starts closed",
			await page.evaluate(() => document.querySelector("[data-slot=inspector]") === null),
		);

		await pressVisibleToggle();
		const overlay = await page
			.waitForSelector("[data-slot=inspector]", { timeout: 5000 })
			.catch(() => null);
		check("the toggle opens the inspector", overlay !== null);
		if (overlay !== null) {
			const coverage = await overlay.evaluate((element) => {
				const box = element.getBoundingClientRect();
				return {
					width: box.width / window.innerWidth,
					height: box.height / window.innerHeight,
				};
			});
			check(
				"the inspector covers the screen it was asked about",
				coverage.width > 0.9 && coverage.height > 0.9,
				`${Math.round(coverage.width * 100)}% wide, ${Math.round(coverage.height * 100)}% tall`,
			);
			const sectionCount = await page.evaluate(
				() => document.querySelectorAll("[data-slot=inspector] [data-section]").length,
			);
			check("the inspector has sections", sectionCount >= 3, `${sectionCount} sections`);
			const openSections = () =>
				page.evaluate(() =>
					[
						...document.querySelectorAll(
							'[data-slot=inspector] [data-section] button[aria-expanded]',
						),
					].filter((element) => element.getAttribute("aria-expanded") === "true").length,
				);
			check(
				"every section is readable when the overlay opens",
				(await openSections()) === sectionCount,
				`${await openSections()} of ${sectionCount} open`,
			);
			const sandboxText = await page.evaluate(
				() =>
					document.querySelector("[data-slot=inspector] [data-section=sandbox]")
						?.textContent ?? "",
				);
			check(
				"the inspector says where the tools run",
				/engine/.test(sandboxText) && /tools/.test(sandboxText),
				sandboxText.replace(/\s+/g, " ").slice(0, 90),
			);

			await press(page, "[data-slot=inspector] [data-section] button[aria-expanded]");
			check(
				"a section can be put away while you read another",
				(await openSections()) === sectionCount - 1,
				`${await openSections()} of ${sectionCount} open`,
			);

			await page.keyboard.press("Escape");
			await page.waitForFunction(
				() => document.querySelector("[data-slot=inspector]") === null,
				{ timeout: 5000 },
			);
			check("the inspector closes", true);

			// Not remembered: the reload is the point of the check, so it comes after a visit.
			await pressVisibleToggle();
			await page.waitForSelector("[data-slot=inspector]", { timeout: 5000 });
			await page.reload({ waitUntil: "domcontentloaded" });
			await page.waitForSelector("[data-slot=inspector-toggle]", { timeout: 15000 });
			check(
				"the inspector is not remembered across a reload",
				await page.evaluate(() => document.querySelector("[data-slot=inspector]") === null),
			);
		}
	}

	// 8. The phone gets the transcript, not a rail eating it; the drawer is how the rail opens.
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
		// The drawer closes with the rail's own icon, not an X in a different corner.
		const drawerClose = await page
			.waitForSelector('[role="dialog"] button[aria-label="Hide the rail"]', {
				timeout: 5000,
				visible: true,
			})
			.catch(() => null);
		check("the drawer carries the rail's own close", drawerClose !== null);
		if (drawerClose !== null) {
			// The drawer slides in from the left; clicking before it lands aims at a point that
			// is still off the screen.
			await page.waitForFunction(
				() =>
					(document
						.querySelector('[role="dialog"] button[aria-label="Hide the rail"]')
						?.getBoundingClientRect().x ?? -1) >= 0,
				{ timeout: 5000 },
			);
			// Clicked through the page, not through this handle: a re-render between the wait and
			// the click replaces the node, and a stale handle clicks at coordinates that are gone.
			await press(page, '[role="dialog"] button[aria-label="Hide the rail"]');
		} else {
			await page.keyboard.press("Escape");
		}
		await page.waitForFunction(() => document.querySelector("[role=dialog]") === null, { timeout: 5000 });
		check("the drawer closes", true);
	}

	// 9. A conversation the worker no longer knows is a refusal, not a white screen: the
	// rail stays up, and the strip names the id that failed. The final error check below is
	// what would have caught the crash this replaces.
	await page.goto(`${url}/c/general/does-not-exist`, { waitUntil: "domcontentloaded" });
	await page.waitForSelector("[data-slot=conversation-list]", { timeout: 15000 });
	await page
		.waitForFunction(
			() => document.querySelector("[data-slot=error-strip]") !== null,
			{ timeout: 15000 },
		)
		.catch(() => null);
	const refusal = await page.evaluate(
		() => document.querySelector("[data-slot=error-strip]")?.textContent ?? "",
	);
	check(
		"a gone conversation refuses instead of crashing",
		refusal.includes("does-not-exist"),
		refusal.replace(/\s+/g, " ").slice(0, 90),
	);

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
