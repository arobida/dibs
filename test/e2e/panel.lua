-- UI tests for the dibs task panels: drives real agent TUIs in a throwaway Rex session.
-- Usage: nub run test:ui   (builds first), or: rex do test/e2e/panel.lua [agent=pi|claude|opencode]
-- Needs Rex and the agent CLIs on PATH.
-- No prompts are sent, so no model tokens are spent; only the panel UI is exercised.
local TERM = "com.superlogical.terminal"
local SID -- the throwaway session; block calls default to the caller's session otherwise

local function sh(argv, opts)
  local r, err = rex.exec(argv, opts)
  if not r then error(err, 0) end
  if not r.ok then error(table.concat(argv, " ") .. ": " .. r.stderr .. r.stdout, 0) end
  return (r.stdout:gsub("%s+$", ""))
end

local root = sh({ "git", "rev-parse", "--show-toplevel" })
-- The user's interactive PATH (rc files add e.g. ~/.opencode/bin). Running agents under "zsh -ic"
-- instead gets Claude Code stopped by SIGTTIN, so read it once and run agents under plain sh.
local user_path = sh({ os.getenv("SHELL") or "sh", "-ic", 'printf "\n%s" "$PATH"' }):match("([^\n]*)$")

-- Each agent: how to start it with the local plugin, the slash command that switches to the project view, and whether the panel reloads on its own.
local agents = {
  pi = {
    cmd = 'exec pi --no-session -ne -e "$ROOT/agents/pi/index.ts"',
    project = "/todos project",
    live = true,
  },
  claude = {
    -- Claude Code loads plugin modules only in a trusted folder, and trusting one writes to
    -- ~/.claude.json, so the test never answers that prompt. It reuses one folder you trust once:
    --   mkdir -p ~/.cache/dibs-ui/claude && cd ~/.cache/dibs-ui/claude && claude   (accept, then /exit)
    dir = os.getenv("HOME") .. "/.cache/dibs-ui/claude",
    fail = { ["Yes, I trust this folder"] = "untrusted folder: trust ~/.cache/dibs-ui/claude once (see test/e2e/panel.lua)" },
    cmd = 'exec claude --plugin-dir "$ROOT/dist/claude-code"',
    project = "/todos project",
    live = true, -- polls every 3 s
  },
  opencode = {
    -- A private config dir so the test never edits the user's cli.json.
    setup = function(dir)
      sh({ "mkdir", "-p", dir .. "/xdg/opencode" })
      local f = assert(io.open(dir .. "/xdg/opencode/cli.json", "w"))
      -- The directory, not plugin/tui.tsx: opencode 2.3.2 ignores a file path here.
      f:write(rex.json.encode({ plugins = { root .. "/agents/opencode" } }))
      f:close()
    end,
    -- --standalone: the shared background service would use the user's config instead.
    cmd = 'XDG_CONFIG_HOME="$DIR/xdg" exec opencode --standalone',
    -- The panel lives in the session view's composer; a "!" shell command opens a session without the model.
    open = { ready = "Ask anything", line = "!echo dibs-ui" },
    project = "/tasks-view", -- cycles current -> project
    live = false, -- refreshes only on todo_ tool calls and commands
  },
}

local function screen(block_id)
  local r = rex.block.call(TERM, "format", { session_id = SID, block_id = block_id, trim = true })
  return r and r.content or ""
end

local function type_line(block_id, text)
  rex.block.call(TERM, "write", { session_id = SID, block_id = block_id, data = text })
  rex.sleep(0.5) -- let autocomplete settle before Enter
  rex.block.call(TERM, "write", { session_id = SID, block_id = block_id, data = "\r" })
end

-- Poll the screen until every plain-text needle shows; a "fail" pattern aborts at once.
local function expect(block_id, needles, timeout, fail)
  local deadline, s = os.time() + timeout, ""
  repeat
    s = screen(block_id)
    for p, why in pairs(fail or {}) do
      if s:find(p, 1, true) then error({ error = why, screen = s }, 0) end
    end
    local all = true
    for _, n in ipairs(needles) do
      if not s:find(n, 1, true) then all = false end
    end
    if all then return end
    rex.sleep(0.5)
  until os.time() > deadline
  error({ want = needles, screen = s }, 0)
end

local function run(name, a, sid)
  local dir = a.dir or sh({ "mktemp", "-d", "/tmp/dibs-ui.XXXXXX" })
  if a.dir then sh({ "rm", "-rf", dir }); sh({ "mkdir", "-p", dir }) end
  -- "dibs" on PATH is this checkout, so CLI-driven panels test local code, not npm.
  sh({ "mkdir", dir .. "/bin" })
  local shim = assert(io.open(dir .. "/bin/dibs", "w"))
  shim:write('#!/bin/sh\nexec node "' .. root .. '/lib/cli/index.js" "$@"\n')
  shim:close()
  sh({ "chmod", "+x", dir .. "/bin/dibs" })
  -- DIBS_HOME keeps the user's global store and adapters (Dex, Things) out of the test.
  local env = { DIBS_TRUST = "1", DIBS_AGENT = "ui-test", DIBS_HOME = dir .. "/home" }
  sh({ dir .. "/bin/dibs", "create", "seed task alpha" }, { cwd = dir, env = env })
  if a.setup then a.setup(dir) end

  local w, err = rex.session.new_window {
    session_id = sid,
    window_label = name,
    layout = rex.layout.block {
      flavor = TERM .. ".shell",
      options = {
        cwd = dir,
        command = { "sh", "-c", 'export ROOT="$1" DIR="$2" PATH="$2/bin:$3" DIBS_HOME="$2/home"; ' .. a.cmd, "sh", root, dir, user_path },
        exit = { on_completion = false },
      },
    },
  }
  if err then error(err, 0) end
  local b = w.block_ids[1]

  local step = "start"
  local ok, e = pcall(function()
    if a.open then
      expect(b, { a.open.ready }, 60)
      type_line(b, a.open.line)
    end
    expect(b, { "Current tasks", "No tasks worked on in this session yet" }, 60, a.fail)
    step = "switch to project view"
    type_line(b, a.project)
    -- A new store starts with the onboarding "Hello World" task, hence 2.
    expect(b, { "Project tasks (2 open)", "seed task alpha", "Hello World" }, 15)
    if a.live then
      step = "live reload"
      sh({ dir .. "/bin/dibs", "create", "beta from another agent" }, { cwd = dir, env = env })
      expect(b, { "Project tasks (3 open)", "beta from another agent" }, 15)
    end
  end)
  rex.call("session.close_window", { session_id = sid, window_id = w.window_id })
  sh({ "rm", "-rf", dir })
  if ok then return { agent = name, ok = true } end
  if type(e) ~= "table" then e = { error = tostring(e) } end
  e.agent, e.ok, e.step = name, false, step
  return e
end

local names = rex.args.agent and { rex.args.agent } or { "pi", "claude", "opencode" }
local s, err = rex.call("session.create", { label = "dibs-ui-tests" })
if err then error(err, 0) end
SID = s.session_id
rex.session.attach { session_id = SID }
local results, failed = {}, false
for _, n in ipairs(names) do
  local a = agents[n] or error("unknown agent: " .. n, 0)
  local done, r = pcall(run, n, a, SID)
  if not done then r = { agent = n, ok = false, step = "setup", error = tostring(r) } end
  print((r.ok and "ok   " or "FAIL ") .. n .. (r.ok and "" or " at " .. r.step))
  failed = failed or not r.ok
  table.insert(results, r)
end
rex.call("session.destroy", { session_id = SID })
if failed then
  print(rex.json.encode(results, { indent = true }))
  rex.stop(1)
end
