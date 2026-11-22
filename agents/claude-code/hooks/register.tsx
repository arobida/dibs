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
let path = ''
let launcher: 'dibs' | 'npx' | undefined // the first launcher that ran; later polls skip the ones that don't exist

// The hooks worker may lack the user's PATH (e.g. ~/.bun/bin for dibs and bun), so read it from their shell once.
async function userPath($: EngineInterface) {
  if (path) return path
  const r = await $.process.run(['/bin/sh', '-c', '${SHELL:-/bin/sh} -lic \'printf "\\n%s" "$PATH"\' 2>/dev/null'])
  path = r.stdout.trim().split('\n').pop() ?? ''
  return path
}

async function refresh($: EngineInterface) {
  const v = await read($, view)
  const ids = await read($, mine)
  const args = ['panel', v, '--json', ...(ids.length ? ['--mine', ids.join(',')] : [])]
  const pth = await userPath($)
  const cmd = { dibs: ['dibs', ...args], npx: ['npx', '-y', '@dibs.ai/dibs', ...args] }
  try {
    let r = { exitCode: 127, stdout: '' }
    for (const k of launcher ? [launcher] : (['dibs', 'npx'] as const)) {
      r = await $.process.run(pth ? ['/usr/bin/env', `PATH=${pth}`, ...cmd[k]] : cmd[k])
      if (r.exitCode !== 127) { launcher = k; break }
    }
    const { exitCode, stdout } = r
    if (exitCode !== 0) throw new Error('dibs failed')
    if (stdout === last) return
    const p = JSON.parse(stdout) as Panel
    last = stdout
    await update($, panel, () => p)
  } catch {
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
    if (name.includes('todo_')) await refresh($)
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
