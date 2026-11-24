export type View = 'current' | 'project' | 'completed'
export type PanelRow = { id: string; name: string; state: 'done' | 'started' | 'open' }
export type Panel = { title: string; rows: PanelRow[]; more: number; empty: string | null }

declare module 'claude-code' {
  interface PluginState {
    'dibs': { mine: string[]; view: View; collapsed: boolean; panel: Panel | null }
  }
}
