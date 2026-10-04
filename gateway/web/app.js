// Acornfall client. No framework and no build step: committed state arrives as
// whole view frames over SSE, so rendering is a pure function of the last frame.

// Fails loudly when the client and the markup drift apart, instead of
// deferring the mistake to a property access on undefined.
const el = (id) => {
	const node = document.getElementById(id);
	if (node === null) throw new Error(`index.html is missing #${id}`);
	return node;
};

const els = {
	workspace: el("workspace"),
	status: el("status"),
	model: el("model"),
	transcript: el("transcript"),
	composer: el("composer"),
	input: el("input"),
	steer: el("steer"),
	send: el("send"),
	abort: el("abort"),
	connect: el("connect"),
	sheet: el("sheet"),
	sheetTitle: el("sheet-title"),
	sheetBody: el("sheet-body"),
	sheetClose: el("sheet-close"),
	inspector: el("inspector"),
	toggleInspector: el("toggle-inspector"),
	agentFacts: el("agent-facts"),
	runFacts: el("run-facts"),
	usage: el("usage"),
	raw: el("raw"),
};

let state = null;
let view = null;
let sources = null;

// The provider connection sheet. `flow` is null while browsing the catalog.
const sheet = { open: false, query: "", flow: null };

const escapeHtml = (value) =>
	String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const textOf = (content) => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block) => block && block.type === "text")
		.map((block) => block.text)
		.join("");
};

async function post(path, body) {
	const response = await fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body ?? {}),
	});
	if (!response.ok) throw new Error((await response.text()).trim() || response.statusText);
	return response;
}

function setStatus(text, stateName) {
	els.status.textContent = text;
	if (stateName) els.status.dataset.state = stateName;
	else delete els.status.dataset.state;
}

function live() {
	return view?.docs?.["pi.live"] ?? {};
}

function isBusy() {
	const current = live();
	return Boolean(current.run || current.generation || (current.tools ?? []).some((tool) => tool.status !== "done"));
}

/* ---------- rendering ---------- */

function toolCalls(entries, liveMessage) {
	const calls = new Map();
	const add = (message) => {
		if (!message || !Array.isArray(message.content)) return;
		for (const block of message.content) {
			if (block?.type === "toolCall") calls.set(block.id, { name: block.name, args: block.arguments });
		}
	};
	for (const entry of entries) for (const message of entry.model ?? []) add(message);
	add(liveMessage);
	return calls;
}

function toolCard({ name, args, output, status, isError }) {
	const body = [
		args === undefined ? "" : `$ ${JSON.stringify(args, null, 2)}`,
		output ? `\n${output}` : "",
	]
		.join("\n")
		.trim();
	return `<div class="tool" data-status="${escapeHtml(isError ? "error" : status)}">
		<div class="tool-head">
			<span class="tool-name">${escapeHtml(name)}</span>
			<span class="tool-status">${escapeHtml(isError ? "error" : status)}</span>
		</div>
		${body ? `<pre>${escapeHtml(body)}</pre>` : ""}
	</div>`;
}

// A provider failure is a committed assistant entry with no content and a
// stopReason of error. Rendering it as an empty bubble would hide the only
// explanation the user gets.
function failureOf(message) {
	if (message.stopReason !== "error" && message.stopReason !== "aborted") return null;
	const detail = message.errorMessage ?? (message.stopReason === "aborted" ? "aborted" : "the model call failed");
	return `${message.provider ?? "provider"}/${message.model ?? "model"}: ${detail}`;
}

function renderEntry(entry, calls) {
	switch (entry.kind) {
		case "pi.user": {
			const text = (entry.model ?? []).map((message) => textOf(message.content)).join("\n").trim();
			return text ? `<div class="turn user">${escapeHtml(text)}</div>` : "";
		}
		case "pi.assistant": {
			const message = (entry.model ?? [])[0] ?? {};
			const failure = failureOf(message);
			if (failure !== null) return `<div class="turn error">${escapeHtml(failure)}</div>`;
			const text = (entry.model ?? []).map((item) => textOf(item.content)).join("\n").trim();
			return text ? `<div class="turn assistant">${escapeHtml(text)}</div>` : "";
		}
		case "pi.tool-result": {
			const message = (entry.model ?? [])[0] ?? {};
			const call = calls.get(message.toolCallId) ?? {};
			return toolCard({
				name: message.toolName ?? call.name ?? "tool",
				args: call.args,
				output: textOf(message.content),
				status: "done",
				isError: message.isError === true,
			});
		}
		case "pi.compaction":
			return `<div class="turn notice">context compacted</div>`;
		case "pi.reset":
			return `<div class="turn notice">context reset</div>`;
		case "pi.system":
			return "";
		default:
			return "";
	}
}

function render() {
	const entries = view?.entries ?? [];
	const current = live();
	const liveMessage = current.generation?.message;
	const calls = toolCalls(entries, liveMessage);
	const html = [];

	for (const entry of entries) html.push(renderEntry(entry, calls));

	const settled = new Set(
		entries
			.filter((entry) => entry.kind === "pi.tool-result")
			.map((entry) => (entry.model ?? [])[0]?.toolCallId)
			.filter(Boolean),
	);
	for (const slot of current.tools ?? []) {
		if (settled.has(slot.callId)) continue;
		html.push(
			toolCard({
				name: slot.name,
				args: calls.get(slot.callId)?.args,
				output: slot.output,
				status: slot.status,
				isError: (slot.diagnostics ?? []).some((diagnostic) => diagnostic?.severity === "error"),
			}),
		);
	}

	const streaming = textOf(liveMessage?.content).trim();
	const streamingFailure = liveMessage ? failureOf(liveMessage) : null;
	if (streamingFailure !== null) html.push(`<div class="turn error">${escapeHtml(streamingFailure)}</div>`);
	else if (streaming) html.push(`<div class="turn assistant live">${escapeHtml(streaming)}</div>`);

	const retry = current.generation?.retry;
	if (retry) {
		html.push(`<div class="turn notice">retrying: ${escapeHtml(retry.error ?? "provider error")}</div>`);
	}

	if (html.length === 0) {
		html.push(
			`<div class="empty">
				<p>Acornfall is ready.</p>
				<p>Ask something, or tell it what to do in <code>${escapeHtml(state?.workspace ?? "the workspace")}</code>.</p>
			</div>`,
		);
	}

	const pinnedToBottom =
		els.transcript.scrollTop + els.transcript.clientHeight >= els.transcript.scrollHeight - 80;
	els.transcript.innerHTML = html.join("");
	if (pinnedToBottom) els.transcript.scrollTop = els.transcript.scrollHeight;

	const busy = isBusy();
	setStatus(busy ? "running" : "idle", busy ? "busy" : "idle");
	els.abort.hidden = !busy;
	els.send.textContent = busy && els.steer.checked ? "Steer" : "Send";
	renderInspector();
}

function facts(target, pairs) {
	target.innerHTML = pairs
		.filter(([, value]) => value !== undefined && value !== null && value !== "")
		.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
		.join("");
}

function renderInspector() {
	if (els.inspector.hidden) return;
	const current = live();
	facts(els.agentFacts, [
		["harness", state?.harness],
		["provider", state?.agent?.provider],
		["model", state?.agent?.modelId],
		["thinking", state?.agent?.thinkingLevel ?? "default"],
		["workspace", state?.workspace],
		["sandbox", state?.capabilities?.sandbox],
		["steer", state?.capabilities?.steer ? "yes" : "no"],
	]);
	facts(els.runFacts, [
		["state", isBusy() ? "running" : "idle"],
		["attempt", current.generation?.attempt],
		["tools", (current.tools ?? []).length || undefined],
		["queued", (view?.docs?.["pi.inbox"]?.items ?? []).length || undefined],
		["retry", current.generation?.retry?.error],
		["seq", state?.seq],
	]);
	els.raw.textContent = view ? JSON.stringify(view, null, 2).slice(0, 8000) : "—";
}

async function refreshUsage() {
	try {
		const usage = await (await fetch("/api/usage")).json();
		els.usage.textContent = JSON.stringify(usage, null, 2);
	} catch (error) {
		els.usage.textContent = String(error);
	}
}

/* ---------- provider connection ---------- */

async function loadState() {
	state = await (await fetch("/api/state")).json();
	renderModelPicker();
	render();
	if (sheet.open) renderSheet();
}

function openSheet() {
	sheet.open = true;
	els.sheet.hidden = false;
	renderSheet();
}

function closeSheet() {
	if (sheet.flow && sheet.flow.status === "running") {
		void post("/api/auth/cancel", { authId: sheet.flow.authId }).catch(() => {});
	}
	sheet.open = false;
	sheet.flow = null;
	els.sheet.hidden = true;
}

function providerRow(provider) {
	const badge = provider.authenticated
		? `<span class="badge">connected</span>`
		: `<span class="provider-meta">${provider.models.length} models</span>`;
	const action = provider.authenticated
		? ""
		: `<button class="primary" data-connect="${escapeHtml(provider.id)}" type="button">Connect</button>`;
	return `<div class="provider">
		<div>
			<div class="provider-name">${escapeHtml(provider.name)}</div>
			<div class="provider-meta">${escapeHtml(provider.id)}</div>
		</div>
		<div class="provider-actions">${badge}${action}</div>
	</div>`;
}

function renderSheet() {
	if (sheet.flow) return renderFlow();
	els.sheetTitle.textContent = "Connect a provider";
	const query = sheet.query.toLowerCase();
	const providers = (state?.providers ?? []).filter(
		(provider) =>
			provider.id.toLowerCase().includes(query) || provider.name.toLowerCase().includes(query),
	);
	els.sheetBody.innerHTML = `
		<input class="sheet-search" id="provider-search" placeholder="Search providers" value="${escapeHtml(sheet.query)}" />
		${providers.map(providerRow).join("") || `<div class="empty">No provider matches that.</div>`}`;

	const search = document.getElementById("provider-search");
	search.addEventListener("input", () => {
		sheet.query = search.value;
		renderSheet();
		const next = document.getElementById("provider-search");
		next.focus();
		next.setSelectionRange(next.value.length, next.value.length);
	});
	for (const button of els.sheetBody.querySelectorAll("[data-connect]")) {
		button.addEventListener("click", () => void startLogin(button.dataset.connect));
	}
}

function renderFlow() {
	const flow = sheet.flow;
	els.sheetTitle.textContent = `Connect ${flow.providerName}`;
	const lines = flow.log.map((entry) => {
		if (entry.kind === "device_code") {
			return `<div class="device-code">${escapeHtml(entry.code)}</div>
				<div class="line">Then open <a href="${escapeHtml(entry.url)}" target="_blank" rel="noreferrer">${escapeHtml(entry.url)}</a></div>`;
		}
		const link = entry.url
			? ` <a href="${escapeHtml(entry.url)}" target="_blank" rel="noreferrer">${escapeHtml(entry.url)}</a>`
			: "";
		const extra = (entry.links ?? [])
			.map((item) => ` <a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.label ?? item.url)}</a>`)
			.join("");
		return `<div class="line ${entry.kind === "error" ? "error" : ""}">${escapeHtml(entry.text)}${link}${extra}</div>`;
	}).join("");

	const prompt = flow.prompt;
	const promptHtml = prompt
		? `<form class="prompt-form" id="prompt-form">
			<input id="prompt-input" type="${prompt.promptType === "secret" ? "password" : "text"}"
				placeholder="${escapeHtml(prompt.placeholder ?? "")}" autocomplete="off" autofocus />
			<button class="primary" type="submit">Submit</button>
		</form>`
		: "";

	els.sheetBody.innerHTML = `<div class="auth-log">${lines}</div>${promptHtml}`;

	const form = document.getElementById("prompt-form");
	if (form) {
		const input = document.getElementById("prompt-input");
		input.focus();
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			void answerPrompt(input.value);
		});
	}
}

async function startLogin(providerId) {
	const provider = (state?.providers ?? []).find((item) => item.id === providerId);
	sheet.flow = {
		authId: `local-${providerId}-${Date.now()}`,
		providerId,
		providerName: provider?.name ?? providerId,
		log: [],
		prompt: null,
		status: "running",
	};
	renderFlow();
	try {
		await post("/api/providers/login", { providerId, authType: "api_key" });
	} catch (error) {
		sheet.flow.status = "error";
		sheet.flow.log.push({ kind: "error", text: String(error.message ?? error) });
		renderFlow();
	}
}

async function answerPrompt(value) {
	const flow = sheet.flow;
	if (!flow?.prompt) return;
	const prompt = flow.prompt;
	flow.prompt = null;
	renderFlow();
	try {
		await post("/api/auth/answer", { authId: flow.authId, promptId: prompt.promptId, value });
	} catch (error) {
		flow.log.push({ kind: "error", text: String(error.message ?? error) });
		renderFlow();
	}
}

// Login interactions arrive on the stream and are rendered as they happen.
function handleAuthFrame(frame) {
	const event = frame.event ?? {};
	if (sheet.flow === null || !sheet.open) {
		// A flow started elsewhere (CLI, another tab): show it rather than drop it.
		if (event.kind !== "done" && event.kind !== "error") openSheet();
		if (sheet.flow === null) {
			sheet.flow = {
				authId: frame.authId,
				providerId: event.providerId ?? "provider",
				providerName: event.providerId ?? "provider",
				log: [],
				prompt: null,
				status: "running",
			};
		}
	}
	const flow = sheet.flow;
	if (frame.authId && flow.authId.startsWith("local-") && frame.authId !== flow.authId) flow.authId = frame.authId;
	switch (event.kind) {
		case "prompt":
			flow.prompt = event;
			break;
		case "info":
			flow.log.push({ kind: "info", text: event.message, links: event.links });
			break;
		case "auth_url":
			flow.log.push({ kind: "auth_url", text: event.instructions ?? "Authorize in your browser:", url: event.url });
			break;
		case "device_code":
			flow.log.push({ kind: "device_code", code: event.userCode, url: event.verificationUri });
			break;
		case "progress": {
			const last = flow.log[flow.log.length - 1];
			if (last?.kind === "progress") last.text = event.message;
			else flow.log.push({ kind: "progress", text: event.message });
			break;
		}
		case "done":
			flow.status = "done";
			void loadState().then(() => {
				sheet.flow = null;
				closeSheet();
			});
			break;
		case "error":
			flow.status = "error";
			flow.log.push({ kind: "error", text: event.message });
			break;
		default:
			break;
	}
	renderFlow();
}

/* ---------- model picker ---------- */

function renderModelPicker() {
	const providers = state?.providers ?? [];
	const selected = `${state?.agent?.provider}/${state?.agent?.modelId}`;
	const options = [];
	for (const provider of providers) {
		if (!provider.authenticated || provider.models.length === 0) continue;
		options.push(`<optgroup label="${escapeHtml(provider.name)}">`);
		for (const model of provider.models) {
			const value = `${provider.id}/${model.id}`;
			options.push(
				`<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(model.name)}</option>`,
			);
		}
		options.push("</optgroup>");
	}
	if (options.length === 0) {
		options.push(`<option value="">no provider connected — click Providers</option>`);
	}
	els.model.innerHTML = options.join("");
	els.model.disabled = options.length <= 0;

	const connected = providers.filter((provider) => provider.authenticated).length;
	els.workspace.textContent = `${state?.workspace ?? ""}  ·  ${connected}/${providers.length} providers`;
}

/* ---------- stream ---------- */

function connect() {
	if (sources) sources.close();
	sources = new EventSource("/api/stream");
	sources.addEventListener("state", (event) => {
		state = JSON.parse(event.data);
		renderModelPicker();
		render();
	});
	sources.addEventListener("frame", (event) => {
		const frame = JSON.parse(event.data);
		if (frame.type === "view") {
			view = frame.value;
			state.seq = frame.seq;
			render();
			return;
		}
		if (frame.type === "submission") {
			void refreshUsage();
			return;
		}
		if (frame.type === "auth") {
			handleAuthFrame(frame);
			return;
		}
		if (frame.type === "state") {
			void loadState();
		}
	});
	sources.addEventListener("error", () => {
		setStatus("reconnecting", "offline");
	});
	sources.addEventListener("open", () => {
		setStatus(isBusy() ? "running" : "idle", isBusy() ? "busy" : "idle");
	});
}

/* ---------- input ---------- */

els.composer.addEventListener("submit", async (event) => {
	event.preventDefault();
	const text = els.input.value.trim();
	if (text === "") return;
	const whenBusy = isBusy() && els.steer.checked ? "steer" : "followUp";
	els.input.value = "";
	els.input.style.height = "auto";
	try {
		await post("/api/messages", { text, whenBusy });
	} catch (error) {
		els.input.value = text;
		setStatus(String(error.message ?? error), "offline");
	}
});

els.input.addEventListener("keydown", (event) => {
	if (event.key === "Enter" && !event.shiftKey) {
		event.preventDefault();
		els.composer.requestSubmit();
	}
});

els.input.addEventListener("input", () => {
	els.input.style.height = "auto";
	els.input.style.height = `${Math.min(els.input.scrollHeight, 200)}px`;
});

els.steer.addEventListener("change", () => {
	els.send.textContent = isBusy() && els.steer.checked ? "Steer" : "Send";
});

els.abort.addEventListener("click", async () => {
	try {
		await post("/api/abort");
	} catch (error) {
		setStatus(String(error.message ?? error), "offline");
	}
});

els.model.addEventListener("change", async () => {
	if (els.model.value === "") {
		openSheet();
		return;
	}
	const [provider, modelId] = els.model.value.split("/");
	if (!provider || !modelId) return;
	try {
		await post("/api/agent", { provider, modelId });
	} catch (error) {
		setStatus(String(error.message ?? error), "offline");
	}
});

els.connect.addEventListener("click", () => openSheet());
els.sheetClose.addEventListener("click", () => closeSheet());
els.sheet.addEventListener("click", (event) => {
	if (event.target === els.sheet) closeSheet();
});
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && sheet.open) closeSheet();
});

els.toggleInspector.addEventListener("click", () => {
	const main = document.querySelector("main");
	const closed = main.dataset.inspector === "closed";
	main.dataset.inspector = closed ? "open" : "closed";
	els.inspector.hidden = !closed;
	renderInspector();
});

/* ---------- boot ---------- */

async function boot() {
	setStatus("connecting");
	try {
		state = await (await fetch("/api/state")).json();
	} catch (error) {
		setStatus("gateway unreachable", "offline");
		return;
	}
	renderModelPicker();
	render();
	connect();
	void refreshUsage();
	setInterval(() => void refreshUsage(), 15000);
}

void boot();
