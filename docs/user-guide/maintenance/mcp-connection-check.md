# MCP connection check — October 15, 2026

The user authorized a read-only test using the existing API key in the root
`.env`. The secret was loaded in memory, sent only to the development MCP/API
services, and omitted from terminal output and this record. No key, employee
record, task content, or Trust Center configuration is stored here.

## Tested connections

| Connection | Target | Result |
| --- | --- | --- |
| Hosted Streamable HTTP | `https://mcp.dev.gideondefender.com/mcp` | Passed |
| Local stdio | Owned bundle, development API at `https://opencomp-api.dev.gideondefender.com` | Passed |

The hosted server identified itself as **OpenComp 0.3.0**. Tests used the
installed MCP SDK client, with the hosted handshake and reads completed
between 12:35 and 12:39 UTC (8:35–8:39 a.m. America/New_York).

## Results

| Check | Observation |
| --- | --- |
| MCP initialization | Successful authenticated handshake. |
| Protocol tool discovery | `list_tools`, `describe_tool_input`, and `execute_tool` available. |
| Business-operation discovery | 406 operations returned by `list_tools`. |
| Input-schema discovery | Schemas returned for each tested read. |
| `get-tasks` through hosted MCP | Successful API response; 52 records, declared count 52. |
| `frameworks-find-all` through hosted MCP | Successful API response; 4 records, declared count 4. |
| `get-overview` through hosted MCP | Successful Trust Center overview response. |
| Missing API key | Initialization request rejected with HTTP 401. |
| Local stdio handshake and discovery | Successful; allowlist exposed only `get-tasks`. |
| Local stdio `get-tasks` | Successful API response; 52 records. |

The first overview probe omitted a required input and received an MCP
validation error. It succeeded after supplying
`arguments.request.organizationId` for the current development organization.
This reinforces the guide's instruction to inspect schemas before execution.
The sandbox initially blocked DNS; the live checks above ran with approved
network access.

## Scope and limits

Only GET-backed business tools were executed. No scan, screening, export,
publication, credential creation, or business-data mutation was requested.
The local bundle was rebuilt successfully before its test. The build ran
under Node 20.20.2 and emitted a workspace engine warning because the workspace
requires Node 22 or newer; this probe does not certify Node 20 support.

These results establish current development connectivity with the supplied
key. They do not establish two-tenant isolation, restricted-key permission
denial, revoked-key behavior, OAuth/Gram connectivity, interactive-client
setup, npm package acceptance, production connectivity, or release cutover
acceptance. No release approval flags or persistent client settings changed.

See [Automation and API access](../automation-and-api.md) for the tested
hosted URL, transport, authentication header, and discovery sequence.
