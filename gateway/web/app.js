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

function renderEntry(entry, calls) {
	switch (entry.kind) {
		case "pi.user": {
			const text = (entry.model ?? []).map((message) => textOf(message.content)).join("\n").trim();
			return text ? `<div class="turn user">${escapeHtml(text)}</div>` : "";
		}
		case "pi.assistant": {
			const text = (entry.model ?? []).map((message) => textOf(message.content)).join("\n").trim();
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
	if (streaming) html.push(`<div class="turn assistant live">${escapeHtml(streaming)}</div>`);

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
	const missing = providers.filter((provider) => !provider.authenticated);
	if (options.length === 0) {
		options.push(`<option value="">no provider connected</option>`);
	}
	els.model.innerHTML = options.join("");
	els.model.disabled = options.length <= 0 || missing.length === providers.length;

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
	const [provider, modelId] = els.model.value.split("/");
	if (!provider || !modelId) return;
	try {
		await post("/api/agent", { provider, modelId });
	} catch (error) {
		setStatus(String(error.message ?? error), "offline");
	}
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
