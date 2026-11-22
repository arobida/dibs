/** @jsxImportSource @opentui/solid */
// Live dibs task panel for opencode. API per https://opencode.ai/docs/build/plugins/cli
import { Plugin } from "@opencode/plugin/tui"
import { createSignal, For, Show, onCleanup } from "solid-js"
import { glyph, panel as panelOf, views, type Panel } from "@dibs.ai/dibs/core/panel.ts"
import { findRoot, settings, storeFile } from "@dibs.ai/dibs/core/store.ts"
import { runFile } from "@dibs.ai/dibs/core/tasks.ts"
import type { Ctx } from "@dibs.ai/dibs/core/ctx.ts"

// U: theme token names beyond text.base are undocumented, so plain hex colours.
const COLOR = { done: "#5faf5f", started: "#d7af00", open: "#808080" }

export default Plugin.define({
	id: "dibs.panel",
	setup(context) {
		const [view, setView] = createSignal<(typeof views)[number]>("current")
		const [collapsed, setCollapsed] = createSignal(false)
		const [panel, setPanel] = createSignal<Panel | null>(null)
		const mine = new Set<string>()
		// U: `location` shape is undocumented; fall back to the process cwd.
		const cwd = (context.location as any)?.directory ?? process.cwd()

		// Same trust and temp-store rules as the CLI; the panel only lists, so it never needs exec.
		const ctx: Ctx = { cwd, trusted: () => process.env.DIBS_TRUST === "1" || !!findRoot(cwd), sessionId: () => process.env.DIBS_SESSION ?? cwd, exec: async () => ({ stdout: "", stderr: "not available in the opencode panel", code: 127 }) }
		const refresh = async (): Promise<void> => {
			try { setPanel(panelOf(JSON.parse(await runFile(storeFile(ctx, settings(ctx)), ["list"])), view(), mine)) } catch { setPanel(null) }
		}

		// U: server-event payload shape is not documented. Look for any {tool, input} object whose tool
		// name contains "todo_" anywhere in the event, and treat that as a task tool call.
		const scan = (o: any, depth = 0): any => {
			if (!o || typeof o !== "object" || depth > 5) return
			if (typeof o.tool === "string" && o.tool.includes("todo_")) return o
			for (const v of Object.values(o)) { const r = scan(v, depth + 1); if (r) return r }
		}
		let timer: any
		const stop = context.data.listen(({ details }: any) => {
			const hit = scan(details)
			if (!hit) return
			// Replies carry the full id; the input id may be a short prefix.
			const raw = hit.output ?? hit.result ?? hit.state?.output ?? ""
			const out = typeof raw === "string" ? raw : JSON.stringify(raw)
			const full = /task (\S+) "/.exec(out)?.[1]
			const parent = /; parent ([^\s;]+)/.exec(out)?.[1]
			if (full && /todo_(edit|status)$/.test(hit.tool)) mine.add(full)
			else if (full && /todo_create$/.test(hit.tool) && parent && mine.has(parent)) mine.add(full)
			clearTimeout(timer)
			timer = setTimeout(() => void refresh(), 200)
		})

		const cycle = () => { setView(views[(views.indexOf(view()) + 1) % views.length]); void refresh() }
		const toggle = () => setCollapsed(!collapsed())
		// Same keys as the Pi panel; also in the command palette and as slash commands.
		// U: ctrl+shift+* may not reach the app in terminals without kitty keyboard protocol.
		context.keymap.layer(() => ({
			mode: "global", priority: 10,
			commands: [
				{ id: "dibs.view", title: "Cycle task view", bind: "ctrl+shift+v", palette: true, slash: { name: "tasks-view" }, run: cycle },
				{ id: "dibs.toggle", title: "Toggle task panel", bind: "ctrl+shift+t", palette: true, slash: { name: "tasks-toggle" }, run: toggle },
			],
			bindings: ["dibs.view", "dibs.toggle"],
		}))

		context.ui.slot({
			append: "session.composer.top",
			render: () => {
				void refresh()
				const poll = setInterval(() => void refresh(), 3000)
				onCleanup(() => clearInterval(poll))
				return (
					<Show when={panel()}>
						{(p) => (
							<box flexDirection="column">
								<text fg="#5fafd7">{`● ${p().title}  ctrl+shift+v: view`}</text>
								<Show when={!collapsed()} fallback={<text fg="#808080">  ctrl+shift+t to expand</text>}>
									<For each={p().rows}>{(r) => <text fg={COLOR[r.state]}>{`  ${glyph[r.state]} #${r.id} ${r.name}`}</text>}</For>
									<Show when={p().more > 0}><text fg="#808080">{`  +${p().more} more`}</text></Show>
									<Show when={p().empty}><text fg="#808080">{`  ${p().empty}`}</text></Show>
								</Show>
							</box>
						)}
					</Show>
				)
			},
		})
		return () => { stop(); clearTimeout(timer) }
	},
})
