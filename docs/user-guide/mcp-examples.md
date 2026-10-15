# Use MCP: worked examples

These examples read compliance tasks, frameworks, and the Trust Center
overview. Complete [MCP setup](mcp-setup.md) first. Your API key needs
`task:read`, `framework:read`, and `trust:read`, respectively.

## How to read the calls

Your assistant normally makes these calls for you. JSON blocks below are
**MCP tool-call parameters**, containing `name` and `arguments`; they are not
complete HTTP requests or client configuration. An MCP client handles
initialization, protocol framing, authentication headers, and responses.

The hosted dynamic server exposes:

| Tool                  | Purpose                                                     |
| --------------------- | ----------------------------------------------------------- |
| `list_tools`          | Find business operations by name or description.            |
| `describe_tool_input` | Inspect the selected operation's required fields and types. |
| `execute_tool`        | Execute that operation with its business arguments.         |

`search_terms` matches any supplied term against names and descriptions;
it can return several candidates. Choose the relevant operation rather than
executing every match. Tool discovery does not guarantee permission to call
an operation.

## Example 1: list compliance tasks

Ask your assistant:

> List my compliance tasks and group them by status. Show the count and
> identify work that needs attention. Read only; do not update tasks.

### Discover

```json
{
  "name": "list_tools",
  "arguments": { "search_terms": ["get-tasks"] }
}
```

Select `get-tasks` from the results.

### Inspect the input

```json
{
  "name": "describe_tool_input",
  "arguments": { "tool_names": ["get-tasks"] }
}
```

### Execute

```json
{
  "name": "execute_tool",
  "arguments": { "name": "get-tasks", "arguments": {} }
}
```

The operation permits empty arguments. It returns the authenticated
organization's task list. Summarize the returned records by their actual
status; listing tasks does not mark them complete or approve evidence.

For related controls and automation run information, inspect the schema,
then use the optional `includeRelations` field. Its API type is a string:

```json
{
  "name": "execute_tool",
  "arguments": {
    "name": "get-tasks",
    "arguments": { "request": { "includeRelations": "true" } }
  }
}
```

**Check success:** inspect the result's `isError` flag, then the JSON task
list and count in its text content. Match the organization and task scope
with **Compliance → Evidence**. Count is organization-specific; the test
organization returned 52 records, which is not an expected count for yours.

## Example 2: review framework progress

Ask your assistant:

> Show my active frameworks and their recorded progress. Include control
> information where available. Explain gaps without claiming certification.

### Discover

```json
{
  "name": "list_tools",
  "arguments": { "search_terms": ["frameworks-find-all"] }
}
```

### Inspect the input

```json
{
  "name": "describe_tool_input",
  "arguments": { "tool_names": ["frameworks-find-all"] }
}
```

### Execute

```json
{
  "name": "execute_tool",
  "arguments": { "name": "frameworks-find-all", "arguments": {} }
}
```

For a richer response, the schema also permits boolean options:

```json
{
  "name": "execute_tool",
  "arguments": {
    "name": "frameworks-find-all",
    "arguments": {
      "request": { "includeControls": true, "includeScores": true }
    }
  }
}
```

**Check success:** compare the returned frameworks with **Compliance →
Frameworks**. The test organization returned four frameworks. Coverage
measures recorded work; it is not an independent audit opinion. If scores
or control details are absent, report that limitation instead of inferring
completion from the framework's presence.

## Example 3: inspect the Trust Center overview

Ask your assistant:

> Read the Trust Center overview for my organization and summarize its
> configured content. Do not publish or change anything. Ask for my
> organization ID if you cannot establish it from the current context.

### Discover

```json
{
  "name": "list_tools",
  "arguments": { "search_terms": ["get-overview"] }
}
```

Select the operation described as **Get trust portal overview**.

### Inspect the input

```json
{
  "name": "describe_tool_input",
  "arguments": { "tool_names": ["get-overview"] }
}
```

This operation requires `request.organizationId`. Use the organization ID
from your OpenComp URL, `/{organizationId}/…`, or ask your administrator.
Replace `YOUR_ORGANIZATION_ID` below with that exact value.

### Execute

```json
{
  "name": "execute_tool",
  "arguments": {
    "name": "get-overview",
    "arguments": {
      "request": { "organizationId": "YOUR_ORGANIZATION_ID" }
    }
  }
}
```

**Check success:** the result contains the requested overview. Compare it
with **Trust → Overview**. This read does not enable the portal, publish
content, approve visitors, or verify every public document. Use the public
portal to inspect the visitor experience. An explicit organization ID does
not authorize cross-organization access.

## Read and handle responses

MCP wraps business responses in `content` blocks. For these JSON reads,
inspect the `text` blocks and parse their JSON. A typical list response has
`data` and `count`; a single-resource response has that resource's fields.
Use the actual response rather than assuming all operations share a shape.

A successful MCP transport exchange can still contain a tool error:

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "Invalid input for tool get-overview." }]
}
```

This is an illustrative validation error, not a successful empty overview.
Call `describe_tool_input`, correct the input, and retry. For API failures,
check the returned HTTP status: 401 points to authentication, 403 to access,
and 503 to temporary service availability. Do not invent records or claim a
read succeeded when `isError` is true.

## Use a local server in static mode

Without `--mode dynamic`, a local server exposes selected business tools
directly. After discovering and inspecting `get-tasks` through your client's
tool list, its call parameters are:

```json
{ "name": "get-tasks", "arguments": {} }
```

For `get-overview`, direct `arguments` would contain
`{"request":{"organizationId":"YOUR_ORGANIZATION_ID"}}`. Do not wrap a
static business call inside `execute_tool` unless the server exposes that
dynamic dispatcher.

## Before requesting changes

Use the read examples to verify the deployment and organization. For a
mutation, discover the exact operation, inspect its schema, review the
records and proposed change, and follow your team's approval process.
Do not retry a timed-out mutation blindly: check whether it already completed.

Connection and read tests passed against the development service on
October 15, 2026. The optional relation and score variants above are checked
against the branch's schemas; the live connection test used the base reads.
Other clients, deployments, and feature-gated actions need their own checks.
