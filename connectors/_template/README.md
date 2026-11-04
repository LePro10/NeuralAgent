# Connector template

A connector is a small program the NeuralAgent autopilot talks to (MCP over stdio). This folder is
the starting point the app copies when you press **New connector**.

| File | What |
|---|---|
| `connector.json` | The manifest: name, a beginner guide, the setup form, a class for every tool. |
| `index.mjs` | The server: tools, and events if it listens to something. |
| `lib/connector.mjs` | The helper (JSON-RPC, config, secrets, state, HTTP). Do not edit. |
| `connector.test.mjs` | Tests with a mocked network. Run `node --test`. |
| `CLAUDE.md` | Instructions for the coding agent that builds the connector. |

Needs Node 22 or newer. No `npm install`.

Try it by hand:

```
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | NA_CONFIG='{}' node index.mjs
```

The repo's own connectors (`connectors/discord`, `github`, `feed`, `web-api`) and
`connectors/examples/neuralagent-admin` show finished versions.
