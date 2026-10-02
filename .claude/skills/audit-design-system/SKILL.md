---
name: audit-design-system
description: Audit & fix design system usage — migrate @trycompai/design-system and @trycompai/design-system/icons to @gideon-defender/ui and lucide-react
---

Audit the specified files for design system compliance. **Fix every issue found immediately.**

## Rules

1. **`@gideon-defender/ui`** is the primary component library. `@trycompai/design-system` is being phased out — only use as last resort for existing imports. Do NOT add new imports from it.
2. **Always check `@gideon-defender/ui` exports first** before reaching for anything else. Check `packages/ui/src/components/` for the component.
3. **Icons**: Use `lucide-react`, NOT `@trycompai/design-system/icons` (Carbon icons, being retired). Migrate existing Carbon imports to lucide-react when touching a file.
4. **`@gideon-defender/ui` components accept `className`** (merged via `cn()`) — use variants + `className` for layout tweaks.
5. **Button**: Use `@gideon-defender/ui` `Button` with `variant`/`size` + `disabled` state; render spinners/icons as children.
6. **Layout**: Use Tailwind flex/grid utilities + `@gideon-defender/ui` `Card`, `Sheet`, `Separator`.
7. **Patterns**: Sheet (`Sheet > SheetContent > SheetHeader + SheetBody`), Drawer, Collapsible from `@gideon-defender/ui` subpaths.

## Process

1. Read files specified in `$ARGUMENTS`
2. Find `@trycompai/design-system` imports — migrate to `@gideon-defender/ui` equivalent
3. Find `@trycompai/design-system/icons` imports — migrate to matching `lucide-react` icons
4. Migrate components and icons
5. Run typecheck to verify: `pnpm --filter=@gideon-defender/app run typecheck` (or `pnpm exec turbo run typecheck --filter=@gideon-defender/app`)
