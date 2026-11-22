import { type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { existsSync, mkdirSync, watch, type FSWatcher, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type Task } from "@dibs.ai/dibs/core/todo.ts";
import { home } from "@dibs.ai/dibs/core/util.ts";
import { link, migrate, resolveLink, setScope, settings, storeFile } from "@dibs.ai/dibs/core/store.ts";
import { toolArgs } from "@dibs.ai/dibs/core/tools.ts";
import { runFile } from "@dibs.ai/dibs/core/tasks.ts";
import { dexWatchDirs } from "@dibs.ai/dibs/core/adapters/dex/index.ts";
import { ghUser } from "@dibs.ai/dibs/core/identity.ts";
import { syncAll as syncAllCore } from "@dibs.ai/dibs/core/adapters/sync-all.ts";
import { saveThingsToken } from "@dibs.ai/dibs/core/adapters/things/index.ts";
import type { Ctx } from "@dibs.ai/dibs/core/ctx.ts";
import { glyph, panel, shown as shownCore, views, type View } from "@dibs.ai/dibs/core/panel.ts";

const toCtx = (pi: ExtensionAPI, ctx: ExtensionContext): Ctx => ({ cwd: ctx.cwd, trusted: () => ctx.isProjectTrusted(), sessionId: () => ctx.sessionManager.getSessionId(), exec: (cmd, args, opts) => pi.exec(cmd, args, opts) });

export default function taskPanel(pi: ExtensionAPI) {
	let tasks: Task[] = [];
	let collapsed = false;
	// Tasks this Pi session created/started/completed/edited; saved as session entries so resume restores them.
	const mine = new Set<string>();
	function track(id: string) {
		if (mine.has(id)) return;
		mine.add(id);
		pi.appendEntry("dex-current", { id });
	}
	function restore(ctx: ExtensionContext) {
		mine.clear();
		for (const e of ctx.sessionManager.getEntries() as any[]) if (e.type === "custom" && e.customType === "dex-current" && e.data?.id) mine.add(e.data.id);
	}
	let view: View = "current";
	let tui: TUI | undefined;
	const claim = (ctx: ExtensionContext) => `${ctx.sessionManager.getSessionId()}:${process.pid}`;
	async function run(ctx: ExtensionContext, args: string[], signal?: AbortSignal, global = false): Promise<string> {
		const s = settings(toCtx(pi, ctx), global), file = storeFile(toCtx(pi, ctx), s);
		if (args[0] === "list" || args[0] === "ready") await syncAll(ctx, global);
		const out = await runFile(file, args);
		if (!["list", "ready", "export"].includes(args[0])) await syncAll(ctx, global);
		return out;
	}
	// Adapters with sync on mirror the dibs store; runs are chained so two syncs never interleave.
	let syncing: Promise<void> = Promise.resolve();
	function syncAll(ctx: ExtensionContext, global = false): Promise<void> {
		const s = settings(toCtx(pi, ctx), global), file = storeFile(toCtx(pi, ctx), s);
		syncing = syncing.catch(() => {}).then(async () => {
			for (const r of await syncAllCore(toCtx(pi, ctx), s, file)) if (r.error && ctx.hasUI) ctx.ui.notify(`Tasks: ${r.name} sync failed: ${r.error}`, "error");
		});
		return syncing;
	}

	const shown = () => shownCore(tasks, view, mine);

	function render(theme: Theme, width: number): string[] {
		const p = panel(tasks, view, mine);
		const lines = [`${theme.fg("accent", "●")} ${theme.fg("accent", p.title)} ${theme.fg("dim", "ctrl+shift+v: view")}`];
		if (collapsed) lines.push(theme.fg("dim", "  ctrl+shift+t to expand"));
		else if (p.empty) lines.push(theme.fg("dim", `  ${p.empty}`));
		else {
			const color = { done: "success", started: "warning", open: "dim" } as const;
			for (const r of p.rows) lines.push(`  ${theme.fg(color[r.state], glyph[r.state])} ${theme.fg("dim", `#${r.id}`)} ${r.state === "done" ? theme.strikethrough(theme.fg("muted", r.name)) : r.name}`);
			if (p.more) lines.push(theme.fg("dim", `  +${p.more} more`));
		}
		return lines.map((line) => truncateToWidth(line, width, "…"));
	}

	async function refresh(ctx: ExtensionContext) {
		// The panel reads the store as-is: mutations already synced, and remote edits arrive via explicit list or watchers.
		const data = JSON.parse(await runFile(storeFile(toCtx(pi, ctx), settings(toCtx(pi, ctx))), ["list"]));
		if (!Array.isArray(data)) throw new Error("Invalid task list");
		tasks = data;
		if (!ctx.hasUI) return;
		ctx.ui.setWidget("dex-panel", (t, theme) => {
			tui = t;
			return { render: (width: number) => render(theme, width), invalidate() {} };
		}, { placement: "aboveEditor" });
	}

	// One shared runner behind six small tools, so each schema marks exactly the fields its action needs.
	async function act(action: string, p: Record<string, any>, signal: AbortSignal | undefined, ctx: ExtensionContext) {
		if (action === "link") return link(toCtx(pi, ctx), p.id);
		if (action === "resolve") return resolveLink(p.url);
		const args = await toolArgs(action, p, { creator: "pi", claim: claim(ctx), user: () => ghUser(toCtx(pi, ctx)) });
		const output = await run(ctx, args, signal);
		// Track the full id from the reply: the call may have used a short prefix.
		if (action !== "list") {
			const full = output.match(/task (\S+) "/)?.[1];
			const par = output.match(/; parent ([^\s;]+)/)?.[1];
			if (full && (action !== "create" || (par && mine.has(par)))) track(full);
		}
		// The change is already saved; a failed reload must not make the agent retry it.
		try { await refresh(ctx); } catch (error) { if (ctx.hasUI) ctx.ui.notify(`Tasks: ${error}`, "error"); }
		return output;
	}
	const Id = Type.String({ description: "Task id, or any unique prefix (e.g. a1b2c3 for proj-a1b2c3)" });
	const Blockers = Type.Array(Type.String(), { description: "Ids (or unique prefixes) of tasks that must complete first" });
	const tool = (name: string, description: string, parameters: any, action = name.slice(5)) => pi.registerTool({
		name, label: "Tasks", description, parameters: { ...parameters, additionalProperties: false }, // unknown fields fail loudly instead of being dropped
		// Shown to the user as one family (`todo › create …`); the model still sees flat tools.
		renderCall(args: any, theme: Theme, context: any) {
			const key = args.name ?? args.id ?? args.url ?? args.query ?? (args.ready ? "ready" : "");
			const text = context?.lastComponent ?? new Text("", 0, 0);
			text.setText(`${theme.fg("toolTitle", theme.bold(`todo › ${action}`))} ${key}${args.status ? ` → ${args.status}` : ""}`);
			return text;
		},
		async execute(_id, params, signal, _onUpdate, ctx) { return { content: [{ type: "text", text: await act(action, { ...(params as object) }, signal, ctx) }], details: {} }; },
	});
	tool("todo_list", "List tasks as a JSON array. ready: true lists only open, unclaimed, unblocked tasks. Ids are short and project-prefixed (e.g. proj-a1b2c3).", Type.Object({
		query: Type.Optional(Type.String({ description: "Case-insensitive text to match in task name or description" })),
		ready: Type.Optional(Type.Boolean({ description: "Only tasks ready to work on" })),
		human: Type.Optional(Type.String({ description: "Only tasks for this GitHub user; \"me\" for the current user" })),
	}));
	tool("todo_create", "Create a task. Returns its id.", Type.Object({
		name: Type.String({ description: "Task name, one line" }),
		// Required: Kimi often omitted it when optional; "" is allowed for no details.
		description: Type.String({ description: "Task details; \"\" if none" }),
		parent: Type.Optional(Type.String({ description: "Id of an existing task to nest under" })),
		blocked_by: Type.Optional(Blockers),
	}));
	tool("todo_edit", "Change a task. Give only the fields to change; at least one is required.", Type.Object({
		id: Id,
		name: Type.Optional(Type.String({ description: "New task name" })),
		description: Type.Optional(Type.String({ description: "New task details" })),
		human: Type.Optional(Type.String({ description: "GitHub user in the loop; \"me\" for the current user; \"\" clears it" })),
		blocked_by: Type.Optional(Type.Array(Type.String(), { description: "Replaces the blocker list; [] clears it" })),
	}));
	tool("todo_status", "Start or complete a task. Starting claims it for this session.", Type.Object({
		id: Id,
		status: Type.Union([Type.Literal("started"), Type.Literal("completed")]),
		result: Type.Optional(Type.String({ description: "Only with completed: what was done (default: Completed)" })),
		force: Type.Optional(Type.Boolean({ description: "Override another live session's claim" })),
	}));
	tool("todo_link", "Get a Markdown dibs:// link to a task, for use in notes or other projects.", Type.Object({ id: Id }));
	tool("todo_resolve", "Read the task behind a dibs:// link, from any project.", Type.Object({ url: Type.String({ description: "A dibs://<project-id>/<task-id> link" }) }));

	pi.registerCommand("todos", {
		description: "Show tasks or move todo.txt: /todos [current|project|completed|export <path>|import <path>|migrate .dibs|.agents/dibs|scope project|global|connect things <token>] [--global]", 
		async handler(args, ctx) {
			try {
				let want = String(args ?? "").trim();
				const global = /\s--global$/.test(want);
				if (global) want = want.slice(0, -9).trim();
				const conn = want.match(/^connect\s+things\s+(\S+)$/);
				if (conn) { ctx.ui.notify(saveThingsToken(conn[1]), "info"); await refresh(ctx); return; }
				const mig = want.match(/^migrate\s+(\.dibs|\.agents\/dibs)$/);
				const sc = want.match(/^scope\s+(project|global)$/);
				if (mig || sc) { ctx.ui.notify(mig ? migrate(toCtx(pi, ctx), mig[1]) : await setScope(toCtx(pi, ctx), sc![1]), "info"); void watchStore(ctx); await refresh(ctx); return; }
				const io = want.match(/^(export|import)\s+(.+)$/);
				if (io) {
					const path = resolve(ctx.cwd, home(io[2].trim()));
					if (io[1] === "import") { ctx.ui.notify(await run(ctx, ["import", readFileSync(path, "utf8")], undefined, global), "info"); await refresh(ctx); return; }
					const { text, skipped } = JSON.parse(await run(ctx, ["export"], undefined, global));
					writeFileSync(path, text, { flag: "wx" });
					ctx.ui.notify(`Exported tasks to ${path}`, "info");
					if (skipped.length) ctx.ui.notify(`Not exported, todo.txt would misread these names (they start like a marker: x, (A), or a date). Rename them or give them a created date, then export again:\n${skipped.join("\n")}`, "warning");
					return;
				}
				if ((views as readonly string[]).includes(want)) view = want as typeof view;
				await refresh(ctx);
				const list = shown();
				ctx.ui.notify(list.length ? list.map((t) => `${t.completed ? "✓" : t.started_at ? "◐" : "○"} #${t.id} ${t.name}`).join("\n") : "No todos yet. Ask the agent to add some!", "info");
			} catch (error) { ctx.ui.notify(`Tasks: ${error}`, "error"); }
		},
	});
	pi.registerShortcut("ctrl+shift+t", { description: "Toggle tasks", handler: async () => { collapsed = !collapsed; tui?.requestRender(); } });
	pi.registerShortcut("ctrl+shift+v", { description: "Cycle task view (current/project/completed)", handler: async () => { view = views[(views.indexOf(view) + 1) % views.length]; tui?.requestRender(); } });
	// Live panel: reload when the task storage changes, so tasks other agents add show up right away.
	let watchers: FSWatcher[] = [];
	const unwatch = () => { for (const w of watchers) w.close(); watchers = []; };
	async function watchStore(ctx: ExtensionContext) {
		unwatch();
		try {
			const s = settings(toCtx(pi, ctx));
			const file = storeFile(toCtx(pi, ctx), s);
			const dir = dirname(file); mkdirSync(dir, { recursive: true });
			let timer: ReturnType<typeof setTimeout> | undefined;
			const later = (fn: () => Promise<unknown>) => { clearTimeout(timer); timer = setTimeout(() => { fn().catch(() => {}); }, 200); };
			// Watch the folder, not the file: saves replace the file by rename.
			const watchDir = (d: string, recursive: boolean, onChange: (name: string | null) => void) => {
				if (!d || !existsSync(d)) return;
				const w = watch(d, { recursive }, (_e, name) => onChange(name));
				w.on("error", () => w.close());
				watchers.push(w);
			};
			watchDir(dir, false, (name) => { if (name === file.slice(dir.length + 1)) later(() => refresh(ctx)); });
			// Dex edits from other agents pull in through sync, which then rewrites the store and refreshes.
			if (s.adapters.dex?.sync) for (const d of (await dexWatchDirs(toCtx(pi, ctx))) ?? []) watchDir(d, true, () => later(() => syncAll(ctx)));
		} catch {}
	}
	pi.on("session_shutdown", async (_event, ctx) => { unwatch(); try { await runFile(storeFile(toCtx(pi, ctx), settings(toCtx(pi, ctx))), ["release", "--claim", claim(ctx)]); } catch {} });
	pi.on("session_start", async (_event, ctx) => { void watchStore(ctx); restore(ctx); try { await refresh(ctx); } catch (error) { if (ctx.hasUI) ctx.ui.notify(`Tasks: ${error}`, "error"); } });
	// Reload the store before each prompt so tasks other agents wrote show up; adapters sync on task tool calls and the Dex watcher, not here.
	pi.on("before_agent_start", async (_event, ctx) => { try { await refresh(ctx); } catch {} });
	pi.on("tool_result", async (event, ctx) => {
		if (event.isError) return;
		try { if (!settings(toCtx(pi, ctx)).adapters.dex?.sync) return; } catch (error) { if (ctx.hasUI) ctx.ui.notify(`Tasks: ${error}`, "error"); return; }
		// Only the todo_* tools mark tasks as this session's; shell text can't prove what ran, so bash dex calls just refresh.
		const command = event.toolName === "bash" ? String(event.input?.command ?? "") : "";
		if (/\bdex\b/.test(command) || /dex/i.test(event.toolName)) {
			try { await refresh(ctx); } catch (error) { if (ctx.hasUI) ctx.ui.notify(`Tasks: ${error}`, "error"); }
		}
	});
}
