# Historical Speakeasy reference (not OpenComp owned compiler guidance)

## Speakeasy Extensions Reference

Extensions (`x-speakeasy-*`) customize SDK generation. Apply them via overlays.

| Extension                            | Applies To        | Purpose                       |
| ------------------------------------ | ----------------- | ----------------------------- |
| `x-speakeasy-retries`                | Operation or root | Configure retry behavior      |
| `x-speakeasy-pagination`             | Operation         | Enable automatic pagination   |
| `x-speakeasy-name-override`          | Operation         | Override SDK method name      |
| `x-speakeasy-group`                  | Operation         | Group methods under namespace |
| `x-speakeasy-unknown-values`         | Schema with enum  | Allow unknown enum values     |
| `x-speakeasy-globals`                | Root              | Define SDK-wide parameters    |
| `x-speakeasy-custom-security-scheme` | Security scheme   | Multi-part custom auth        |

### Retries

```yaml
actions:
  - target: "$.paths['/resources'].get" # Or "$" for global
    update:
      x-speakeasy-retries:
        strategy: backoff
        backoff:
          initialInterval: 500 # ms
          maxInterval: 60000 # ms
          maxElapsedTime: 3600000 # ms
          exponent: 1.5
        statusCodes: ['5XX', '429']
        retryConnectionErrors: true
```

### Pagination

**Offset/Limit:**

```yaml
actions:
  - target: "$.paths['/users'].get"
    update:
      x-speakeasy-pagination:
        type: offsetLimit
        inputs:
          - name: offset
            in: parameters
            type: offset
          - name: limit
            in: parameters
            type: limit
        outputs:
          results: $.data
          numPages: $.meta.total_pages
```

**Cursor:**

```yaml
actions:
  - target: "$.paths['/events'].get"
    update:
      x-speakeasy-pagination:
        type: cursor
        inputs:
          - name: cursor
            in: parameters
            type: cursor
        outputs:
          results: $.events
          nextCursor: $.next_cursor
```

### Open Enums (Anti-Fragility)

Prevent SDK breakage when APIs return new enum values:

```yaml
actions:
  - target: '$.components.schemas.Status'
    update:
      x-speakeasy-unknown-values: allow
```

For all enums (add `x-speakeasy-jsonpath: rfc9535` at overlay root):

```yaml
actions:
  - target: $..[?length(@.enum) > 1]
    update:
      x-speakeasy-unknown-values: allow
```

### Global Headers

Add SDK-wide headers as constructor options:

```yaml
actions:
  - target: $
    update:
      x-speakeasy-globals:
        parameters:
          - $ref: '#/components/parameters/TenantId'
  - target: $.components
    update:
      parameters:
        TenantId:
          name: X-Tenant-Id
          in: header
          schema:
            type: string
```

Result: `client = SDK(api_key="...", tenant_id="tenant-123")`

### Custom Security Schemes

For complex auth (HMAC, multi-part credentials):

```yaml
actions:
  - target: $.components
    update:
      securitySchemes:
        hmacAuth:
          type: http
          scheme: custom
          x-speakeasy-custom-security-scheme:
            schema:
              type: object
              properties:
                keyId:
                  type: string
                keySecret:
                  type: string
  - target: $
    update:
      security:
        - hmacAuth: []
```

With `envVarPrefix: MYAPI` in gen.yaml, generates env var support for `MYAPI_KEY_ID`, `MYAPI_KEY_SECRET`.

## JSONPath Targeting Reference

| Target                                      | Selects                       |
| ------------------------------------------- | ----------------------------- |
| `$.paths['/users'].get`                     | GET /users operation          |
| `$.paths['/users/{id}'].*`                  | All operations on /users/{id} |
| `$.paths['/users'].get.parameters[0]`       | First parameter of GET /users |
| `$.components.schemas.User`                 | User schema definition        |
| `$.components.schemas.User.properties.name` | Name property of User schema  |
| `$.info`                                    | API info object               |
| `$.info.title`                              | API title                     |
| `$.servers[0]`                              | First server entry            |

## What NOT to Do

- **Do NOT** use overlays for invalid YAML/JSON syntax errors -- fix the source file
- **Do NOT** try to fix broken `$ref` paths with overlays -- fix the source spec
- **Do NOT** use overlays to fix wrong data types -- this is an API design issue
- **Do NOT** try to deduplicate schemas with overlays -- requires structural analysis
- **Do NOT** ignore errors that require source spec fixes -- overlays cannot solve everything
- **Do NOT** modify source OpenAPI specs directly if they are externally managed
- **Do NOT** use a `speakeasy overlay create` command -- it does not exist

## Troubleshooting

| Error                        | Cause                                  | Solution                                                    |
| ---------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| "target not found"           | JSONPath does not match spec structure | Verify exact path and casing by inspecting the spec         |
| Changes not applied          | Overlay not in workflow                | Add overlay to `sources.overlays` in `workflow.yaml`        |
| "invalid overlay"            | Malformed YAML                         | Check overlay structure: needs `overlay`, `info`, `actions` |
| YAML parse error             | Invalid overlay syntax                 | Check YAML indentation and quoting                          |
| No changes visible           | Wrong target path                      | Use `$.paths['/exact-path']` with exact casing              |
| Errors persist after overlay | Issue not overlay-appropriate          | Check if the issue requires a source spec fix instead       |
| Overlay order conflict       | Later overlay overrides earlier        | Reorder overlays in `workflow.yaml` or merge into one file  |

## After Making Changes

After creating or modifying overlay files and adding them to workflow.yaml, **prompt the user** to regenerate the SDK:

> **Overlay configuration complete.** Would you like to regenerate the SDK now with `speakeasy run`?

If the user confirms, run:

```bash
speakeasy run --output console
```

Overlay changes only take effect in the SDK after regeneration.
