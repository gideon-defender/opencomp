# Historical Speakeasy reference (not OpenComp owned compiler guidance)

## Using the Generated MCP Server

### CLI Usage

```bash
# Start with stdio transport (default, for local AI assistants)
npx my-api-mcp mcp start --bearer-auth "YOUR_TOKEN"

# Start with SSE transport (for networked deployment)
npx my-api-mcp mcp start --transport sse --port 3000 --bearer-auth "YOUR_TOKEN"

# Filter by scope (only expose read operations)
npx my-api-mcp mcp start --scope read --bearer-auth "YOUR_TOKEN"

# Mount specific tools only
npx my-api-mcp mcp start --tool users-get-users --tool users-create-user --bearer-auth "YOUR_TOKEN"
```

### CLI Options

| Flag            | Description                       | Default    |
| --------------- | --------------------------------- | ---------- |
| `--transport`   | Transport type: `stdio` or `sse`  | `stdio`    |
| `--port`        | Port for SSE transport            | `2718`     |
| `--bearer-auth` | API authentication token          | Required   |
| `--server-url`  | Override API base URL             | From spec  |
| `--scope`       | Filter by scope (repeatable)      | All scopes |
| `--tool`        | Mount specific tools (repeatable) | All tools  |
| `--log-level`   | Logging level                     | `info`     |

### Claude Desktop Configuration

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "my-api": {
      "command": "npx",
      "args": [
        "-y",
        "--package",
        "my-api-mcp",
        "--",
        "mcp",
        "start",
        "--bearer-auth",
        "<API_TOKEN>"
      ]
    }
  }
}
```

### Claude Code Configuration

Add to `.claude/settings.json` or use `claude mcp add`:

```json
{
  "mcpServers": {
    "my-api": {
      "command": "npx",
      "args": [
        "-y",
        "--package",
        "my-api-mcp",
        "--",
        "mcp",
        "start",
        "--bearer-auth",
        "<API_TOKEN>"
      ]
    }
  }
}
```

### Docker Deployment

For production, use SSE transport with Docker:

```bash
# Build and run
docker-compose up -d

# Configure MCP client to use SSE endpoint
# "url": "http://localhost:32000/sse"
```

The generated project includes a Dockerfile and docker-compose.yaml.

## Example

Full example generating an MCP server for a pet store API:

```bash
# 1. Validate the spec
speakeasy lint openapi --non-interactive -s ./petstore.yaml

# 2. Create scopes overlay
cat > mcp-scopes-overlay.yaml << 'EOF'
openapi: 3.1.0
overlay: 1.0.0
info:
  title: Add MCP scopes
  version: 0.0.0
actions:
  - target: $.paths.*["get","head"]
    update:
      x-speakeasy-mcp:
        scopes: [read]
        disabled: false
  - target: $.paths.*["post","put","delete","patch"]
    update:
      x-speakeasy-mcp:
        scopes: [write]
        disabled: false
EOF

# 3. Create workflow (assumes .speakeasy/ dir exists)
mkdir -p .speakeasy
cat > .speakeasy/workflow.yaml << 'EOF'
workflowVersion: 1.0.0
speakeasyVersion: latest
sources:
  petstore:
    inputs:
      - location: ./petstore.yaml
    overlays:
      - location: mcp-scopes-overlay.yaml
    output: openapi.yaml
targets:
  mcp-server:
    target: mcp-typescript
    source: petstore
EOF

# 4. Create gen.yaml
cat > .speakeasy/gen.yaml << 'EOF'
configVersion: 2.0.0
generation:
  sdkClassName: PetStoreMcp
  maintainOpenAPIOrder: true
typescript:
  version: 1.0.0
  packageName: petstore-mcp
  envVarPrefix: PETSTORE
EOF

# 5. Generate
speakeasy run

# 6. Test locally
npx petstore-mcp mcp start --bearer-auth "test-token"
```

### Expected Output

```
Workflow completed successfully.
Generated TypeScript MCP server in ./
```

The generated project contains:

- `src/mcp-server/server.ts` -- Main MCP server factory
- `src/mcp-server/tools/` -- One tool per API operation
- `src/mcp-server/mcp-server.ts` -- CLI entry point
- `src/mcp-server/scopes.ts` -- Scope definitions

## Best Practices

1. **Use overlays for MCP config** -- never edit the source OpenAPI spec directly
2. **Enhance descriptions for AI** -- add documentation overlays so AI assistants understand tool purpose
3. **Filter tools at runtime** -- use `--scope` and `--tool` flags to limit what is exposed
4. **Use environment variables** -- never hardcode tokens in config files
5. **Start with read-only scopes** -- add write scopes only when needed
6. **Create a dedicated MCP package** -- keep MCP separate from your main SDK

## What NOT to Do

- **Do NOT** modify the source OpenAPI spec to add `x-speakeasy-mcp` -- use overlays instead
- **Do NOT** hardcode API tokens in Claude Desktop or Claude Code config files -- use environment variables or secrets managers
- **Do NOT** expose all operations without reviewing them -- disable sensitive admin endpoints
- **Do NOT** skip spec validation -- invalid specs produce broken MCP servers
- **Do NOT** use the deprecated `enableMCPServer: true` flag in gen.yaml -- use the standalone `mcp-typescript` target in workflow.yaml instead
- **Do NOT** generate without a scopes overlay -- tools will lack scope definitions
- **Do NOT** use the generated MCP server as a general SDK -- it is purpose-built for AI assistant integration

## Troubleshooting

### MCP server fails to start

**Symptom:** `npx my-api-mcp mcp start` errors immediately.

**Cause:** Missing or invalid authentication flags.

**Fix:**

```bash
# Ensure auth flag matches your API's auth scheme
npx my-api-mcp mcp start --bearer-auth "YOUR_TOKEN"

# Check --help for available auth flags
npx my-api-mcp mcp start --help
```

### No tools appear in AI assistant

**Symptom:** MCP server starts but AI assistant shows no tools.

**Cause:** Missing `x-speakeasy-mcp` extensions or all operations disabled.

**Fix:** Verify the scopes overlay is listed in `workflow.yaml` under `overlays:` and that operations have `disabled: false`.

### Generation fails with mcp-typescript target

**Symptom:** `speakeasy run` fails when using `target: mcp-typescript`.

**Cause:** Usually a spec validation issue, missing workflow config, or using the deprecated `enableMCPServer` flag instead of the `mcp-typescript` target.

**Fix:**

```bash
# Validate spec first
speakeasy lint openapi --non-interactive -s ./openapi.yaml

# Ensure workflow.yaml uses target: mcp-typescript (NOT target: typescript with enableMCPServer)
cat .speakeasy/workflow.yaml

# Remove enableMCPServer from gen.yaml if present -- it is deprecated
```

### Tools missing expected operations

**Symptom:** Some API operations are not available as MCP tools.

**Cause:** Operations not targeted by the scopes overlay or explicitly disabled.

**Fix:** Review `mcp-scopes-overlay.yaml` target selectors. Ensure paths and methods match your spec.
