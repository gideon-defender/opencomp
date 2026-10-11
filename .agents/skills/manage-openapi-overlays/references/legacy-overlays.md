# Historical Speakeasy reference (not OpenComp owned compiler guidance)

Overlays let you customize an OpenAPI spec for SDK generation without modifying the source. This skill covers creating overlay files, applying them to specs, and using them to fix validation errors.

## Content Guides

The original vendor validation/security guides are not bundled in this skill.
For an explicitly requested legacy project, consult the installed Speakeasy agent
context for validation and security-scheme instructions.

## Authentication

Set `SPEAKEASY_API_KEY` env var or run `speakeasy auth login`.

## When to Use

Use this skill when you need to **manually work with overlay files**:

- Creating an overlay file from scratch with specific JSONPath targets
- Applying an existing overlay file to a spec
- Validating overlay syntax and structure
- Comparing two specs to generate an overlay
- Understanding overlay mechanics (actions, targets, update/remove)
- Fixing lint issues via manual overlay creation
- User says: "create overlay", "apply overlay", "overlay file", "manual overlay", "overlay syntax", "JSONPath targeting", "validate overlay"

**NOT for**: AI-powered naming suggestions (see `improve-sdk-naming` instead)

## Inputs

| Input          | Required | Description                                             |
| -------------- | -------- | ------------------------------------------------------- |
| Target spec    | Yes      | OpenAPI spec to customize or fix                        |
| Customizations | Depends  | Changes to apply (groups, names, retries, descriptions) |
| Overlay file   | Depends  | Existing overlay to apply (for apply workflow)          |
| Lint output    | Helpful  | Validation errors to fix (for fix workflow)             |

## Outputs

| Output        | Description                              |
| ------------- | ---------------------------------------- |
| Overlay file  | YAML file with JSONPath-targeted changes |
| Modified spec | Transformed OpenAPI spec (when applying) |

## Commands

### Generate an Overlay by Comparing Specs

```bash
speakeasy overlay compare -b <before-spec> -a <after-spec> -o <output-overlay>
```

Use this when you have a modified version of a spec and want to capture the differences as a reusable overlay.

### Apply an Overlay to a Spec

```bash
speakeasy overlay apply -s <spec-path> -o <overlay-path> --out <output-path>
```

### Validate an Overlay

```bash
speakeasy overlay validate -o <overlay-path>
```

## Creating an Overlay Manually

Create an overlay file with this structure:

```yaml
overlay: 1.0.0
info:
  title: My Overlay
  version: 1.0.0
actions:
  - target: "$.paths['/example'].get"
    update:
      x-speakeasy-group: example
      x-speakeasy-name-override: getExample
```

Each action has a `target` (JSONPath expression) and an `update` (object to merge) or `remove` (boolean to delete the target).

## Example: SDK Method Naming and Grouping

```yaml
overlay: 1.0.0
info:
  title: SDK Customizations
  version: 1.0.0
actions:
  - target: "$.paths['/users'].get"
    update:
      x-speakeasy-group: users
      x-speakeasy-name-override: list
  - target: "$.paths['/users'].post"
    update:
      x-speakeasy-group: users
      x-speakeasy-name-override: create
  - target: "$.paths['/users/{id}'].get"
    update:
      x-speakeasy-group: users
      x-speakeasy-name-override: get
  - target: "$.paths['/users/{id}'].delete"
    update:
      x-speakeasy-group: users
      x-speakeasy-name-override: delete
      deprecated: true
```

This produces SDK methods: `sdk.users.list()`, `sdk.users.create()`, `sdk.users.get()`, `sdk.users.delete()`.

## Example: Apply Overlay

```bash
# Apply overlay and write merged spec
speakeasy overlay apply -s openapi.yaml -o sdk-overlay.yaml --out openapi-modified.yaml

# Compare two specs to generate an overlay
speakeasy overlay compare -b original.yaml -a modified.yaml -o changes-overlay.yaml
```

## Using in Workflow (Recommended)

Instead of applying overlays manually, add them to `.speakeasy/workflow.yaml`:

```yaml
sources:
  my-api:
    inputs:
      - location: ./openapi.yaml
    overlays:
      - location: ./naming-overlay.yaml
      - location: ./grouping-overlay.yaml
```

Overlays are applied in order. Later overlays can override earlier ones. This approach ensures overlays are always applied during `speakeasy run`.

## Common Fix Patterns

Use overlays to fix validation issues when you cannot edit the source spec.

| Issue                     | Overlay Fix                                         |
| ------------------------- | --------------------------------------------------- |
| Poor operation names      | Add `x-speakeasy-name-override` to the operation    |
| Missing descriptions      | Add `summary` or `description` to the operation     |
| Missing tags              | Add `tags` array to the operation                   |
| Need operation grouping   | Add `x-speakeasy-group` to operations               |
| Need retry config         | Add `x-speakeasy-retries` to operations or globally |
| Deprecate an endpoint     | Add `deprecated: true` to the operation             |
| Add SDK-specific metadata | Add any `x-speakeasy-*` extension                   |

### Fix Workflow

```bash
# 1. Validate the spec to identify issues
speakeasy lint openapi --non-interactive -s openapi.yaml

# 2. Create an overlay file targeting each issue (see patterns above)

# 3. Add overlay to workflow.yaml under sources.overlays

# 4. Regenerate the SDK
speakeasy run --output console
```
