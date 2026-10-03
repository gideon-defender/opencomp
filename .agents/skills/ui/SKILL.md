---
name: ui
description: 'Use when building or editing frontend UI components, layouts, styling, design system usage, colors, dark mode, or icons.'
---

Source Cursor rule: `.cursor/rules/ui.mdc`.
Original Cursor alwaysApply: `true`.

# UI Components

## Design System Priority

1. **First choice:** `@gideon-defender/ui`
2. **Last resort only:** Existing `@trycompai/design-system` imports (being phased out — do NOT add new imports)

```tsx
// ✅ @gideon-defender/ui
import { Button } from '@gideon-defender/ui/button';
import { Card } from '@gideon-defender/ui/card';
import { Input } from '@gideon-defender/ui/input';
import { Badge } from '@gideon-defender/ui/badge';
import { Plus, ArrowRight } from 'lucide-react';

// ❌ Do NOT add new @trycompai/design-system imports
import { Button, Card, Input, Sheet, Badge } from '@trycompai/design-system';
import { Add, Close, ArrowRight } from '@trycompai/design-system/icons';
```

## className on @gideon-defender/ui Components

`@gideon-defender/ui` components accept `className` (merged via `cn()`). Use variants + `className` for layout tweaks.

```tsx
// ✅ Use variants + className
<Button variant="destructive" size="sm">Delete</Button>
<Button type="submit" className="w-full">Continue</Button>
<Badge variant="outline">Active</Badge>
```

## Layout with Wrapper Divs

For layout concerns, wrap DS components:

```tsx
// ✅ Wrapper for width
<div className="w-full">
  <Button>Full Width</Button>
</div>

// ✅ Use Stack for spacing
<Stack gap="4" direction="row">
  <Button>First</Button>
  <Button>Second</Button>
</Stack>
```

## Componentize Repeated Patterns

If a pattern appears 2+ times, extract it:

```tsx
// Repeated? Make a component
<div className="flex items-center gap-2">
  <div className="w-2 h-2 rounded-full bg-green-500" />
  <span className="text-sm">Active</span>
</div>
// → Create <StatusDot status="active" />
```

## Extension Strategy

When you need new styling:

1. **Check existing variants** - component may already support it
2. **Add a variant** to the component's `cva` definition
3. **Create a new component** if it's a genuinely new pattern

```tsx
// Adding a variant
const badgeVariants = cva('...', {
  variants: {
    variant: {
      // existing...
      counter: 'bg-muted text-muted-foreground tabular-nums font-mono',
    },
  },
});
```

## Semantic Colors

Use CSS variables, not hardcoded colors:

```tsx
// ✅ Semantic tokens
<div className="bg-background text-foreground border-border">
<div className="bg-muted text-muted-foreground">
<div className="bg-destructive/10 text-destructive">

// ❌ Hardcoded
<div className="bg-white text-black">
<div className="bg-[#059669]">
```

## Dark Mode

Always support both modes:

```tsx
// Status colors with dark variants
<div className="bg-green-50 dark:bg-green-950/20 text-green-600 dark:text-green-400">
<div className="bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400">
```

## Icons

`lucide-react` icons, not Carbon:

```tsx
// ✅ lucide-react icons with className sizing
import { Plus, X, ChevronDown } from 'lucide-react';
<Plus className="h-4 w-4" />;

// ❌ Don't add new @trycompai/design-system/icons (Carbon) imports
import { Add, Close, ChevronDown } from '@trycompai/design-system/icons';
```

## Anti-Patterns

```tsx
// ❌ Never do these
<div style={{ display: 'flex' }}>              // Inline styles
<div className="bg-[#059669]">                // Hardcoded colors
<div className="w-[847px]">                   // Arbitrary values
```
