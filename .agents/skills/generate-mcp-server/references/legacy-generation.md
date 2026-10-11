# Historical Speakeasy reference (not OpenComp owned compiler guidance)

Generate a Model Context Protocol (MCP) server from an OpenAPI spec using Speakeasy. The MCP server exposes API operations as tools that AI assistants like Claude can call directly.

## When to Use

- User wants to create an MCP server from their API
- User asks about Model Context Protocol integration
- User wants AI assistants to interact with their API
- User says: "generate MCP server", "create MCP server", "speakeasy MCP"
- User asks: "How do I make my API available to Claude?"
- User mentions: "mcp-typescript", "AI assistant tools", "Claude tools"

## Inputs

| Input          | Required | Description                                                          |
| -------------- | -------- | -------------------------------------------------------------------- |
| OpenAPI spec   | Yes      | Path or URL to the OpenAPI specification                             |
| Package name   | Yes      | npm package name for the MCP server (e.g., `my-api-mcp`)             |
| Auth method    | Yes      | How the API authenticates (bearer token, API key, etc.)              |
| Env var prefix | No       | Prefix for environment variables (e.g., `MYAPI`)                     |
| Scope strategy | No       | How to map operations to scopes (default: read/write by HTTP method) |

## Outputs

| Output            | Description                                                |
| ----------------- | ---------------------------------------------------------- |
| MCP server        | TypeScript MCP server with one tool per API operation      |
| CLI entry point   | Command-line interface with stdio and SSE transports       |
| Scope definitions | Scope-based access control for filtering tools             |
| Docker support    | Dockerfile and compose config for containerized deployment |
| Workflow config   | `.speakeasy/workflow.yaml` configured for MCP generation   |

## Prerequisites

1. Speakeasy CLI installed and authenticated:

```bash
speakeasy auth login
# Or for CI/AI agents:
export SPEAKEASY_API_KEY="<your-api-key>"
```

2. Node.js 20+ installed (for the generated MCP server).

3. A valid OpenAPI spec (3.0 or 3.1). Validate first:

```bash
speakeasy lint openapi --non-interactive -s ./openapi.yaml
```

Run `speakeasy auth login` to authenticate interactively, or set the `SPEAKEASY_API_KEY` environment variable.

## Command

The generation uses `speakeasy run` after configuring the workflow, overlays, and gen.yaml. There is no single command -- follow the step-by-step workflow below.

```bash
# After all config files are in place:
speakeasy run
```

## Step-by-Step Workflow

### Step 1: Create the Scopes Overlay

Create `mcp-scopes-overlay.yaml` in the project root. This controls which API operations become MCP tools and what scopes they require:

```yaml
# mcp-scopes-overlay.yaml
openapi: 3.1.0
overlay: 1.0.0
info:
  title: Add MCP scopes
  version: 0.0.0
actions:
  # Enable read operations
  - target: $.paths.*["get","head"]
    update:
      x-speakeasy-mcp:
        scopes: [read]
        disabled: false

  # Enable write operations
  - target: $.paths.*["post","put","delete","patch"]
    update:
      x-speakeasy-mcp:
        scopes: [write]
        disabled: false

  # Disable specific sensitive endpoints (customize as needed)
  # - target: $.paths["/admin/danger-zone"]["delete"]
  #   update:
  #     x-speakeasy-mcp:
  #       disabled: true
```

### Step 2: Create the Workflow Configuration

Create `.speakeasy/workflow.yaml`:

```yaml
# .speakeasy/workflow.yaml
workflowVersion: 1.0.0
speakeasyVersion: latest
sources:
  My-API:
    inputs:
      - location: ./openapi.yaml
    overlays:
      - location: mcp-scopes-overlay.yaml
    output: openapi.yaml
targets:
  mcp-server:
    target: mcp-typescript
    source: My-API
```

Replace `./openapi.yaml` with the actual spec path or URL.

> **Important:** Use the standalone `mcp-typescript` target, not `typescript` with `enableMCPServer: true`. The embedded approach (`enableMCPServer` flag) is deprecated.

### Step 3: Configure gen.yaml

Create `.speakeasy/gen.yaml`:

```yaml
# .speakeasy/gen.yaml
configVersion: 2.0.0
generation:
  sdkClassName: MyApiMcp
  maintainOpenAPIOrder: true
  devContainers:
    enabled: true
    schemaPath: ./openapi.yaml
typescript:
  version: 1.0.0
  packageName: my-api-mcp
  envVarPrefix: MYAPI
```

Key settings:

- `target: mcp-typescript` in `workflow.yaml` -- this is what triggers MCP server generation
- `packageName` -- the npm package name users will `npx`
- `envVarPrefix` -- prefix for auto-generated env var names

### Step 4: Generate

```bash
speakeasy run
```

For AI-friendly output:

```bash
speakeasy run --output console 2>&1 | tail -50
```
