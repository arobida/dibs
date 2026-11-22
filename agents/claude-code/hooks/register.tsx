import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Panel, View } from '../types'

const mine = atom({ plugin: 'dibs', key: 'mine' } as const, [] as string[])
const view = atom({ plugin: 'dibs', key: 'view' } as const, 'current' as View)
const collapsed = atom({ plugin: 'dibs', key: 'collapsed' } as const, false)
const panel = atom({ plugin: 'dibs', key: 'panel' } as const, null as Panel | null)

const views: View[] = ['current', 'project', 'completed']
const glyph = { done: '✓', started: '◐', open: '○' } as const
const color = { done: 'green', started: 'yellow', open: undefined } as const

let last = ''
let server: string | undefined // the name /mcp lists this plugin's dibs server under

async function refresh($: EngineInterface) {
  const v = await read($, view)
  const ids = await read($, mine)
  try {
    if (!server) {
      const c = await $.mcp.connect('dibs')
      if (!c.isConnected) throw new Error(c.message)
      server = c.server
    }
    const r = await $.mcp.call(server, 'todo_panel', { view: v, mine: ids })
    const text = r.content?.find((c: any) => c.type === 'text')?.text
    if (r.isError || typeof text !== 'string') throw new Error('dibs failed')
    if (text === last) return
    const p = JSON.parse(text) as Panel
    last = text
    await update($, panel, () => p)
  } catch {
    server = undefined
    last = ''
    await update($, panel, () => null)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'todos',
      description: 'Task panel: switch view or collapse',
      argumentHint: '[current|project|completed|toggle]',
    })
    await refresh($)
    $.clock.every(3000, () => refresh($))
    return next(e)
  })

  // The panel's own tool: the model uses todo_list instead.
  on('tool.offer', async ($, e, next) => (/dibs.*__todo_panel$/.test(e.tool) ? { isOffered: false } : next(e)))

  on('tool.call', async ($, e, next) => {
    const name: string = e.tool
    const res = await next(e)
    const text = 'text' in res && typeof res.text === 'string' ? res.text : JSON.stringify(res)

    if (/dibs.*todo_(create|edit|status)$/.test(name)) {
      // Replies carry the full id; the input id may be a short prefix.
      const full = /task (\S+) "/.exec(text)?.[1]
      const parent = /; parent ([^\s;]+)/.exec(text)?.[1]
      const ids = await read($, mine)
      if (full && (!/todo_create$/.test(name) || (parent && ids.includes(parent))))
        await update($, mine, m => (m.includes(full) ? m : [...m, full]))
    }
    if (name.includes('todo_') && !name.endsWith('todo_panel')) await refresh($) // the panel's own call needs no second refresh
    return res
  })

  on('command.run', { command: 'todos' }, async ($, e, next) => {
    const arg = e.args.trim()
    if (arg === 'toggle') await update($, collapsed, c => !c)
    else if ((views as string[]).includes(arg)) {
      await update($, view, () => arg as View)
      await refresh($)
    } else if (arg) return { text: 'Usage: /todos [current|project|completed|toggle]' }
    else await update($, view, v => views[(views.indexOf(v) + 1) % views.length] ?? 'current')
    if (!arg) await refresh($)
    return { text: 'ok' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = await read($, panel)
    if (e.props.hasSurvey || p === null) return next(e)
    const hide = await read($, collapsed)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="cyan">● {p.title}</Text>
          <Text dimColor> /todos {hide ? 'toggle to expand' : '[current|project|completed|toggle]'}</Text>
        </Text>
        {hide ? null : p.empty ? (
          <Text dimColor>  {p.empty}</Text>
        ) : (
          <Box flexDirection="column">
            {p.rows.map(r => (
              <Text key={r.id} color={color[r.state]} dimColor={r.state !== 'started' && r.state !== 'done'} strikethrough={r.state === 'done'}>
                {'  '}{glyph[r.state]} #{r.id} {r.name}
              </Text>
            ))}
            {p.more ? <Text dimColor>  +{p.more} more</Text> : null}
          </Box>
        )}
      </Box>
    )
  })
}
