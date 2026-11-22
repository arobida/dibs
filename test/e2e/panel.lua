-- UI tests for the dibs task panels: drives real agent TUIs in a throwaway Rex session.
-- Usage: nub run test:ui   (builds first), or: rex do test/e2e/panel.lua [agent=pi|claude|opencode]
-- Needs Rex and the agent CLIs on PATH.
-- No prompts are sent, so no model tokens are spent; only the panel UI is exercised.
-- Claude's panel reads tasks through the plugin's MCP server; the other panels read this checkout's core directly.
local TERM = "com.superlogical.terminal"
local SID -- the throwaway session; block calls default to the caller's session otherwise

local function sh(argv, opts)
  local r, err = rex.exec(argv, opts)
  if not r then error(err, 0) end
  if not r.ok then error(table.concat(argv, " ") .. ": " .. r.stderr .. r.stdout, 0) end
  return (r.stdout:gsub("%s+$", ""))
end

local root = sh({ "git", "rev-parse", "--show-toplevel" })

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
    setup = function(dir)
      sh({ "cp", "-R", root .. "/dist/claude-code", dir .. "/plugin" })
      -- The published .mcp.json runs npx; the test runs this checkout's CLI through the shim, so shim.log proves it.
      local f = assert(io.open(dir .. "/plugin/.mcp.json", "w"))
      f:write(rex.json.encode({ mcpServers = { dibs = { command = dir .. "/bin/dibs", args = { "mcp" } } } }))
      f:close()
    end,
    cmd = 'exec claude --plugin-dir "$DIR/plugin"',
    project = "/todos project",
    live = true, -- polls every 3 s
    cli = true, -- the MCP server's "mcp" call lands in shim.log
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
    live = true, -- the panel imports the dibs core from this checkout through the workspace link
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

local function run_body(name, a, sid)
  if a.dir then sh({ "mkdir", "-p", a.dir }) end
  local dir = sh({ "mktemp", "-d", (a.dir or "/tmp") .. "/dibs-ui.XXXXXX" })
  -- "dibs" on PATH is this checkout, so CLI-driven panels test local code, not npm.
  sh({ "mkdir", dir .. "/bin" })
  local shim = assert(io.open(dir .. "/bin/dibs", "w"))
  shim:write('#!/bin/sh\necho "$*" >> "' .. dir .. '/shim.log"\nexec node "' .. root .. '/lib/cli/index.js" "$@"\n')
  shim:close()
  sh({ "chmod", "+x", dir .. "/bin/dibs" })
  -- DIBS_HOME keeps the user's global store and adapters (Dex, Things) out of the test.
  local env = { DIBS_TRUST = "1", DIBS_AGENT = "ui-test", DIBS_HOME = dir .. "/home" }
  sh({ dir .. "/bin/dibs", "create", "seed task alpha" }, { cwd = dir, env = env })
  os.remove(dir .. "/shim.log")
  if a.setup then a.setup(dir) end

  -- rex do runs from the user's terminal, so its PATH is the interactive one.
  local w, err = rex.session.new_window {
    session_id = sid,
    window_label = name,
    layout = rex.layout.block {
      flavor = TERM .. ".shell",
      options = {
        cwd = dir,
        command = { "sh", "-c", 'export ROOT="$1" DIR="$2" PATH="$2/bin:$3" DIBS_HOME="$2/home"; ' .. a.cmd, "sh", root, dir, os.getenv("PATH") },
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
    if a.cli then
      local f = io.open(dir .. "/shim.log")
      local log = f and f:read("*a") or ""
      if f then f:close() end
      if log == "" then error({ error = "the panel never ran this checkout's dibs (shim.log empty)" }, 0) end
    end
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

-- A fixed folder (a.dir) is shared between runs, so take a lock on it first.
local function run(name, a, sid)
  if a.dir then
    rex.exec({ "mkdir", "-p", a.dir:match("^(.*)/[^/]+$") })
    local r = rex.exec({ "mkdir", a.dir .. ".lock" })
    if not r or not r.ok then error("another test:ui run holds " .. a.dir .. ".lock", 0) end
  end
  local ok, res = pcall(run_body, name, a, sid)
  if a.dir then rex.exec({ "rmdir", a.dir .. ".lock" }) end
  if not ok then error(res, 0) end
  return res
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
