# dibs for Codex CLI

Requires Node 26+; the CLI runs as `npx -y @dibs.ai/dibs`.

## Install

```sh
nub run build:agent codex
mkdir -p ~/.agents/skills
cp -R dist/codex/skills/dibs ~/.agents/skills/   # or: ln -s "$PWD/dist/codex/skills/dibs" ~/.agents/skills/dibs
```

To install per repo, copy the skill to `<repo>/.agents/skills/dibs`. Restart Codex, which then lists the skill as `dibs`. Codex invokes it implicitly, or you can run `$dibs`.

## Plugin

`dist/codex/` is also a plugin root, holding `plugin.json` (portable format) and `skills/`. To ship it, add it to a marketplace (`.agents/plugins/marketplace.json`, entry `{"name":"dibs","source":{"source":"local","path":"./dist/codex"},"policy":{"installation":"AVAILABLE","authentication":"ON_INSTALL"},"category":"Productivity"}`), then `codex plugin marketplace add <root>` and `codex plugin add dibs@<marketplace-name>` (listed as `dibs:dibs`).

Docs: https://developers.openai.com/codex/skills, https://developers.openai.com/plugins/build/plugins

## Tools (MCP)

The MCP server runs the CLI through `npx -y`. Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.dibs]
command = "npx"
args = ["-y", "@dibs.ai/dibs", "mcp"]
env = { DIBS_TRUST = "1" }  # Codex does not pass your shell env. Omit it if the project has a .dibs folder
```
