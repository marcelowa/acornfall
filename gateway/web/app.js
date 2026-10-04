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
	agent: el("agent"),
	thinking: el("thinking"),
	defaults: el("defaults"),
	rail: el("new-conversation"),
	conversationList: el("conversation-list"),
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
	agentLayers: el("agent-layers"),
	reloadAgents: el("reload-agents"),
	context: el("context"),
	runFacts: el("run-facts"),
	usage: el("usage"),
	raw: el("raw"),
};

let state = null;
let view = null;
let sources = null;

/** The conversation everything is scoped to; ids are the harness's own, opaque. */
const activeId = () => state?.conversation?.id ?? "";
/** Text of the message each branch point precedes, so a fork can offer it back. */
const forkSource = new Map();

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

function renderEntry(entry, calls, forkAt) {
	switch (entry.kind) {
		case "pi.user": {
			const text = (entry.model ?? []).map((message) => textOf(message.content)).join("\n").trim();
			if (!text) return "";
			const button =
				forkAt === null
					? ""
					: `<button class="icon branch" data-fork-at="${escapeHtml(forkAt)}" title="Branch a new conversation from before this message">⑂</button>`;
			return `<div class="turn user">${escapeHtml(text)}${button}</div>`;
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

	// A branch keeps everything before this message, so it forks at the entry
	// that precedes each user turn, not at the turn itself.
	forkSource.clear();
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		const previous = index > 0 ? entries[index - 1] : undefined;
		const forkAt = entry.kind === "pi.user" && previous !== undefined ? String(previous.id) : null;
		if (forkAt !== null) {
			forkSource.set(forkAt, (entry.model ?? []).map((message) => textOf(message.content)).join("\n").trim());
		}
		html.push(renderEntry(entry, calls, forkAt));
	}

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

	const connected = (state?.providers ?? []).some((provider) => provider.authenticated);
	if (html.length === 0) {
		html.push(
			connected
				? `<div class="empty">
					<p>Acornfall is ready.</p>
					<p>Ask something, or tell it what to do in <code>${escapeHtml(state?.workspace ?? "the workspace")}</code>.</p>
				</div>`
				: `<div class="empty">
					<p>No model provider is connected.</p>
					<p>Connect one to start, or add a key from the CLI with
						<code>acornfall provider add &lt;provider&gt; &lt;api-key&gt;</code>.</p>
					<button class="primary cta" id="empty-connect" type="button">Connect a provider</button>
				</div>`,
		);
	}

	const pinnedToBottom =
		els.transcript.scrollTop + els.transcript.clientHeight >= els.transcript.scrollHeight - 80;
	els.transcript.innerHTML = html.join("");
	if (pinnedToBottom) els.transcript.scrollTop = els.transcript.scrollHeight;

	const emptyConnect = document.getElementById("empty-connect");
	if (emptyConnect !== null) emptyConnect.addEventListener("click", () => openSheet());
	for (const button of els.transcript.querySelectorAll("[data-fork-at]")) {
		button.addEventListener("click", () =>
			void forkConversation(button.dataset.forkAt, forkSource.get(button.dataset.forkAt)),
		);
	}

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

function thinkingLabel() {
	const applied = state?.agent?.thinkingLevel || "default";
	const requested = state?.agent?.thinkingRequested;
	return requested ? `${applied} (asked for ${requested})` : applied;
}

function renderInspector() {
	if (els.inspector.hidden) return;
	const current = live();
	const resolved = state?.resolved;
	facts(els.agentFacts, [
		["conversation", `${activeId()} · ${state?.conversation?.title ?? ""}`],
		["definition", resolved?.name ?? "default"],
		["source", resolved?.source || "(layered defaults only)"],
		["harness", state?.harness],
		["model", `${state?.agent?.provider ?? ""}/${state?.agent?.modelId ?? ""}`],
		// The applied level is what runs; when the model could not express the
		// request, say what was asked for instead of appearing to ignore it.
		["thinking", thinkingLabel()],
		["sandbox", state?.capabilities?.sandbox],
	]);
	renderDefaults();
	renderLayers(resolved);
	renderContext();
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

/** Which layer set what, so a surprising prompt is explainable rather than guessed. */
function renderLayers(resolved) {
	const layers = resolved?.layers ?? [];
	const skills = resolved?.skills === null ? "all discovered" : (resolved?.skills ?? []).join(", ") || "none";
	const tools =
		resolved?.allowTools !== undefined
			? `only ${resolved.allowTools.join(", ") || "none"}`
			: (resolved?.denyTools ?? []).length > 0
				? `all except ${resolved.denyTools.join(", ")}`
				: "all registered";
	const layerRows = layers
		.map(
			(trace) => `<details>
				<summary>${escapeHtml(trace.layer)} <span class="provider-meta">${escapeHtml(trace.path)}</span></summary>
				<pre>${escapeHtml(JSON.stringify(trace.contributes ?? {}, null, 2))}</pre>
			</details>`,
		)
		.join("");
	els.agentLayers.innerHTML =
		`<div class="delta">skills: ${escapeHtml(skills)}<br />tools: ${escapeHtml(tools)}</div>` +
		(layerRows || `<div class="delta">no config or definition files</div>`);
}

/**
 * Reconstructs what each request was actually sent, by folding the positional
 * system entries forward. Later entries may carry only the sections that
 * changed, so a patch and a snapshot both fold correctly.
 */
function contextHistory(entries) {
	const sections = new Map();
	const tools = new Map();
	const requests = [];
	for (const entry of entries) {
		if (entry.kind !== "pi.system") continue;
		const message = (entry.model ?? [])[0] ?? {};
		const changes = { sectionsAdded: [], sectionsRemoved: [], sectionsChanged: [], toolsAdded: [], toolsRemoved: [] };
		for (const [name, text] of Object.entries(message.sections ?? {})) {
			const before = sections.get(name);
			if (text === null || text === undefined) {
				if (before !== undefined) {
					sections.delete(name);
					changes.sectionsRemoved.push(name);
				}
				continue;
			}
			if (before === undefined) changes.sectionsAdded.push(name);
			else if (before !== text) changes.sectionsChanged.push(name);
			sections.set(name, text);
		}
		for (const tool of message.toolsAdded ?? []) {
			tools.set(tool.name, tool);
			changes.toolsAdded.push(tool.name);
		}
		for (const tool of message.toolsRemoved ?? []) {
			if (tools.delete(tool.name)) changes.toolsRemoved.push(tool.name);
		}
		requests.push({
			entryId: entry.id,
			sections: new Map(sections),
			tools: new Map(tools),
			changes,
			previousId: requests.length > 0 ? requests[requests.length - 1].entryId : null,
		});
	}
	return requests;
}

function renderContext() {
	const entries = view?.entries ?? [];
	const requests = contextHistory(entries);
	if (requests.length === 0) {
		els.context.innerHTML = `<div class="delta">nothing sent yet</div>`;
		return;
	}
	const latest = requests[requests.length - 1];
	const estimate = (text) => Math.ceil(String(text ?? "").length / 4);

	const sectionRows = [...latest.sections.entries()]
		.map(
			([name, text]) => `<details>
				<summary>${escapeHtml(name)} <span class="provider-meta">${String(text).length} chars · ~${estimate(text)} tok</span></summary>
				<pre>${escapeHtml(text)}</pre>
			</details>`,
		)
		.join("");
	const toolRows = [...latest.tools.values()]
		.map(
			(tool) => `<details>
				<summary>${escapeHtml(tool.name)} <span class="provider-meta">${escapeHtml((tool.description ?? "").slice(0, 48))}</span></summary>
				<pre>${escapeHtml(JSON.stringify(tool.parameters ?? {}, null, 2))}</pre>
			</details>`,
		)
		.join("");

	const changes = latest.changes;
	const delta = [
		changes.sectionsAdded.length > 0 ? `<span class="add">+sections ${changes.sectionsAdded.join(", ")}</span>` : "",
		changes.sectionsChanged.length > 0 ? `~${changes.sectionsChanged.join(", ")}` : "",
		changes.sectionsRemoved.length > 0 ? `<span class="del">−sections ${changes.sectionsRemoved.join(", ")}</span>` : "",
		changes.toolsAdded.length > 0 ? `<span class="add">+tools ${changes.toolsAdded.join(", ")}</span>` : "",
		changes.toolsRemoved.length > 0 ? `<span class="del">−tools ${changes.toolsRemoved.join(", ")}</span>` : "",
	]
		.filter(Boolean)
		.join(" · ");

	const totalTokens = [...latest.sections.values()].reduce((sum, text) => sum + estimate(text), 0);
	const usage = lastUsage(entries);
	els.context.innerHTML = `
		<div class="delta">
			request ${requests.length} · entry ${escapeHtml(latest.entryId)}
			${latest.previousId === null ? " · first" : ` · previous ${escapeHtml(latest.previousId)}`}<br />
			~${totalTokens} tok of sections · ${latest.tools.size} tools
			${usage ? ` · ${usage.input} in / ${usage.output} out / ${usage.cacheRead ?? 0} cached` : ""}
		</div>
		${delta.length > 0 ? `<div class="delta">${delta}</div>` : `<div class="delta">unchanged since the previous request</div>`}
		${sectionRows || `<div class="delta">no prompt sections</div>`}
		${toolRows}`;
}

function lastUsage(entries) {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const message = (entries[index].model ?? [])[0];
		if (entries[index].kind === "pi.assistant" && message?.usage) return message.usage;
	}
	return null;
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
	renderConversations();
	renderAgentPicker();
	renderThinking();
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
	const action = provider.authenticated
		? `<button class="ghost" data-logout="${escapeHtml(provider.id)}" type="button">Disconnect</button>`
		: `<span class="provider-meta">${provider.models.length} models</span>`;
	const connect = provider.authenticated
		? `<button class="ghost" data-connect="${escapeHtml(provider.id)}" type="button">Replace key</button>`
		: `<button class="primary" data-connect="${escapeHtml(provider.id)}" type="button">Connect</button>`;
	const source = provider.authenticated && provider.source
		? `<span class="badge" title="A stored credential, not proof the provider accepts it">key stored</span>`
		: "";
	return `<div class="provider">
		<div>
			<div class="provider-name">${escapeHtml(provider.name)}</div>
			<div class="provider-meta">${escapeHtml(provider.id)}</div>
		</div>
		<div class="provider-actions">${source}${action}${connect}</div>
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
		<p class="provider-meta">A stored key is not a working key: the provider decides at request time,
			and a rejection appears in the transcript.</p>
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
	for (const button of els.sheetBody.querySelectorAll("[data-logout]")) {
		button.addEventListener("click", () => void logoutProvider(button.dataset.logout, button));
	}
}

async function logoutProvider(providerId, button) {
	button.disabled = true;
	button.textContent = "Disconnecting…";
	try {
		await post("/api/providers/logout", { providerId });
		await loadState();
	} catch (error) {
		button.disabled = false;
		button.textContent = "Disconnect";
		setStatus(String(error.message ?? error), "offline");
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
// Nothing opens a sheet on its own: a flow started elsewhere is surfaced, but
// the transcript stays usable either way.
function handleAuthFrame(frame) {
	const event = frame.event ?? {};
	if (sheet.flow === null) {
		if (event.kind === "done" || event.kind === "error") return;
		sheet.flow = {
			authId: frame.authId,
			providerId: event.providerId ?? "provider",
			providerName: event.providerId ?? "provider",
			log: [],
			prompt: null,
			status: "running",
		};
	}
	const flow = sheet.flow;
	if (frame.authId && flow.authId.startsWith("local-") && frame.authId !== flow.authId) flow.authId = frame.authId;
	switch (event.kind) {
		case "prompt":
			flow.prompt = event;
			break;		case "info":
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
	const selected = `${state?.agent?.provider}/${state?.agent?.modelId}`;	const options = [];
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

/** Definitions come from the overlay: global, then workspace, with workspace winning. */
function conversationRow(conversation, active, deleted) {
	const actions = deleted
		? `<button class="icon" data-restore="${escapeHtml(conversation.id)}" title="Restore">↺</button>`
		: `<button class="icon" data-rename="${escapeHtml(conversation.id)}" title="Rename">✎</button>
			<button class="icon" data-hide="${escapeHtml(conversation.id)}" title="Delete">×</button>`;
	return `<div class="conversation-item" data-active="${conversation.id === active}" data-id="${escapeHtml(conversation.id)}">
		<button class="conversation-select" data-conversation="${escapeHtml(conversation.id)}" type="button">
			<span class="title">${escapeHtml(conversation.title)}</span>
			<span class="id">${escapeHtml(conversation.id)}${conversation.root ? " ·root" : ""}</span>
		</button>
		<span class="row-actions">${actions}</span>
	</div>`;
}

function renderConversations() {
	const all = state?.conversations ?? [];
	const active = activeId();
	const visible = all.filter((conversation) => !conversation.hidden);
	const deleted = all.filter((conversation) => conversation.hidden);
	els.conversationList.innerHTML =
		visible.map((conversation) => conversationRow(conversation, active, false)).join("") +
		(deleted.length === 0
			? ""
			: `<details class="deleted"><summary>Deleted (${deleted.length})</summary>
				${deleted.map((conversation) => conversationRow(conversation, active, true)).join("")}
			</details>`);

	for (const button of els.conversationList.querySelectorAll("[data-conversation]")) {
		button.addEventListener("click", () => void selectConversation(button.dataset.conversation));
	}
	for (const button of els.conversationList.querySelectorAll("[data-hide]")) {
		button.addEventListener("click", () => void hideConversation(button.dataset.hide, true));
	}
	for (const button of els.conversationList.querySelectorAll("[data-restore]")) {
		button.addEventListener("click", () => void hideConversation(button.dataset.restore, false));
	}
	for (const button of els.conversationList.querySelectorAll("[data-rename]")) {
		button.addEventListener("click", () => beginRename(button.dataset.rename));
	}
}

/** Rename in place: the row becomes an input, Enter commits, Escape reverts. */
function beginRename(id) {
	const row = els.conversationList.querySelector(`.conversation-item[data-id="${CSS.escape(id)}"]`);
	if (row === null) return;
	const current = (state?.conversations ?? []).find((conversation) => conversation.id === id)?.title ?? "";
	row.innerHTML = `<input class="row-input" value="${escapeHtml(current)}" />`;
	const input = row.querySelector("input");
	input.focus();
	input.setSelectionRange(input.value.length, input.value.length);
	input.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			renderConversations();
			return;
		}
		if (event.key !== "Enter") return;
		event.preventDefault();
		void renameConversation(id, input.value);
	});
	input.addEventListener("blur", () => renderConversations());
}

async function renameConversation(id, title) {
	try {
		await post(`/api/conversations/${id}/rename`, { title });
		await loadState();
	} catch (error) {
		setStatus(String(error.message ?? error), "offline");
		renderConversations();
	}
}

async function hideConversation(id, hidden) {
	try {
		await post(`/api/conversations/${id}/hide`, { hidden });
		await loadState();
	} catch (error) {
		setStatus(String(error.message ?? error), "offline");
	}
}

async function forkConversation(at, text) {
	try {
		await post(`/api/conversations/${activeId()}/fork`, { at });
		view = null;
		await loadState();
		// The fork has the same history minus the message that was branched from,
		// so hand that message back for editing.
		if (text) {
			els.input.value = text;
			els.input.focus();
			els.input.style.height = "auto";
			els.input.style.height = `${Math.min(els.input.scrollHeight, 200)}px`;
		}
	} catch (error) {
		setStatus(String(error.message ?? error), "offline");
	}
}

async function selectConversation(id) {
	if (id === activeId()) return;
	// Clear first: the new transcript arrives as a snapshot frame from the worker.
	view = null;
	state.conversation = { id, title: "" };
	render();
	try {
		await post(`/api/conversations/${id}/select`);
		await loadState();
	} catch (error) {
		setStatus(String(error.message ?? error), "offline");
		// The optimistic switch was wrong: put the real state back.
		await loadState().catch(() => {});
	}
}

async function newConversation() {
	try {
		await post("/api/conversations");
		await loadState();
	} catch (error) {
		setStatus(String(error.message ?? error), "offline");
	}
}

/** Levels come from the model, so the picker never offers one the model cannot do. */
function renderThinking() {
	const binding = state?.agent ?? {};
	const provider = (state?.providers ?? []).find((item) => item.id === binding.provider);
	const model = provider?.models?.find((item) => item.id === binding.modelId);
	const levels = model?.thinkingLevels ?? [];
	const options = [`<option value=""${binding.thinkingLevel ? "" : " selected"}>default</option>`];
	for (const level of levels) {
		options.push(
			`<option value="${escapeHtml(level)}"${level === binding.thinkingLevel ? " selected" : ""}>${escapeHtml(level)}</option>`,
		);
	}
	els.thinking.innerHTML = options.join("");
	els.thinking.disabled = levels.length === 0;
}

/**
 * Defaults apply to conversations that never chose. Each row shows the current
 * default, whether this conversation follows it, and a way to adopt what is
 * running here as the new default.
 */
function renderDefaults() {
	const model = `${state?.defaultModel?.provider ?? ""}/${state?.defaultModel?.modelId ?? ""}`;
	const rows = [
		{
			label: "model",
			value: model === "/" ? "—" : model,
			inherited: state?.inherited?.model,
			current: `${state?.agent?.provider ?? ""}/${state?.agent?.modelId ?? ""}`,
			action: "model",
			clearable: false,
		},
		{
			label: "thinking",
			value: state?.defaultThinking || "—",
			inherited: state?.inherited?.thinking,
			current: state?.agent?.thinkingLevel || "",
			action: "thinking",
			clearable: true,
		},
		{
			label: "agent",
			value: state?.defaultAgent || "layered defaults",
			inherited: state?.inherited?.agent,
			current: state?.agent?.definition || "",
			action: "agent",
			clearable: true,
		},
	];
	els.defaults.innerHTML = rows
		.map((row) => {
			const adopt = row.current && row.current !== row.value
				? `<button class="ghost small" data-adopt="${row.action}" data-value="${escapeHtml(row.current)}" type="button">Use current</button>`
				: "";
			const clear = row.clearable && row.value !== "—" && row.value !== "layered defaults"
				? `<button class="ghost small" data-adopt="${row.action}" data-value="" type="button">Clear</button>`
				: "";
			return `<div class="default-row">
				<span class="provider-meta">${escapeHtml(row.label)}</span>
				<span class="default-value" title="${row.inherited ? "this conversation follows the default" : "this conversation chose its own"}">${escapeHtml(row.value)}${row.inherited ? "" : " *"}</span>
				<span class="row-actions">${adopt}${clear}</span>
			</div>`;
		})
		.join("");

	for (const button of els.defaults.querySelectorAll("[data-adopt]")) {
		button.addEventListener("click", () => void adoptDefault(button.dataset.adopt, button.dataset.value));
	}
}

async function adoptDefault(kind, value) {
	const body =
		kind === "model" ? { provider: state?.agent?.provider ?? "", modelId: state?.agent?.modelId ?? "" }
		: kind === "thinking" ? { level: value }
		: { definition: value };
	const path = kind === "model" ? "/api/default-model" : kind === "thinking" ? "/api/default-thinking" : "/api/default-agent";
	try {
		await post(path, body);
		await loadState();
	} catch (error) {
		setStatus(String(error.message ?? error), "offline");
	}
}

function renderAgentPicker() {
	const agents = state?.agents ?? [];
	const current = state?.agent?.definition ?? "";
	const options = [`<option value=""${current === "" ? " selected" : ""}>default</option>`];
	for (const agent of agents) {
		options.push(
			`<option value="${escapeHtml(agent.name)}"${agent.name === current ? " selected" : ""}>${escapeHtml(agent.name)}</option>`,
		);
	}
	els.agent.innerHTML = options.join("");
	els.agent.title = current === "" ? "layered defaults only" : `from ${state?.resolved?.source ?? ""}`;
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
			if (frame.conversationId !== activeId()) return;
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
		await post(`/api/conversations/${activeId()}/messages`, { text, whenBusy });
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
		await post(`/api/conversations/${activeId()}/abort`);
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
		await post(`/api/conversations/${activeId()}/agent`, { provider, modelId });
		await loadState();
	} catch (error) {
		setStatus(String(error.message ?? error), "offline");
	}
});

// Selecting a definition sends no model, so the definition's own model applies and
// an explicit picker choice still wins until the next definition change.
els.agent.addEventListener("change", async () => {
	try {
		await post(`/api/conversations/${activeId()}/agent`, { definition: els.agent.value });
		await loadState();
	} catch (error) {
		setStatus(String(error.message ?? error), "offline");
	}
});

els.rail.addEventListener("click", () => void newConversation());

els.thinking.addEventListener("change", async () => {
	try {
		await post(`/api/conversations/${activeId()}/agent`, { thinkingLevel: els.thinking.value });
		await loadState();
	} catch (error) {
		setStatus(String(error.message ?? error), "offline");
	}
});

els.reloadAgents.addEventListener("click", async () => {
	els.reloadAgents.textContent = "Reloading…";
	try {
		await post("/api/agents/reload");
		await loadState();
	} catch (error) {
		setStatus(String(error.message ?? error), "offline");
	}
	els.reloadAgents.textContent = "Reload files";
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
	renderConversations();
	renderAgentPicker();
	renderThinking();
	renderModelPicker();
	render();
	connect();
	void refreshUsage();
	setInterval(() => void refreshUsage(), 15000);
}

void boot();
