# UI Component Usage Rules (Design System)

## Core Principle

**ONLY use components from `@gideon-defender/ui`.** Do not use `@trycompai/design-system`, shadcn/ui copies, Radix primitives directly, or custom components when a `@gideon-defender/ui` component exists.

**`@gideon-defender/ui` components accept `className` (merged via `cn()`). Use variants + `className` for one-off layout tweaks.**

`@trycompai/design-system` is being phased out — only use as last resort for existing imports. Do NOT add new imports from it.

## Component Priority

1. **First choice:** `@gideon-defender/ui`
2. **Never:** Custom implementations when `@gideon-defender/ui` has the component
3. **Last resort only:** Existing `@trycompai/design-system` imports (do not add new ones)

```tsx
// ✅ ALWAYS - Use @gideon-defender/ui
import { Button } from '@gideon-defender/ui/button';
import { Table } from '@gideon-defender/ui/table';
import { Badge } from '@gideon-defender/ui/badge';

// ❌ NEVER - Don't add new @trycompai/design-system imports
import { Button, Table, Badge, Tabs } from '@trycompai/design-system';
```

## Server vs Client Components

**Layouts should be server-side rendered.** Any client-side logic (hooks, state, event handlers) must be wrapped in its own `'use client'` component.

```tsx
// ✅ Server layout with client component for interactivity
// layout.tsx (server)
import { ClientTabs } from './components/ClientTabs';

export default function Layout({ children }) {
  return (
    <div>
      <ClientTabs /> {/* Client component for interactive tabs */}
      {children}
    </div>
  );
}

// components/ClientTabs.tsx (client)
'use client';
export function ClientTabs() {
  const router = useRouter();
  // ... client logic
}

// ❌ NEVER - Don't make entire layout a client component
'use client';
export default function Layout({ children }) { ... }
```

## Avoid nuqs

Don't use `nuqs` for query state. Use standard Next.js patterns:

- `useRouter().push()` for navigation
- `useSearchParams()` for reading query params
- Server-side `searchParams` prop for initial state

## Styling with className

`@gideon-defender/ui` components accept `className` and merge it with variants via `cn()`:

```tsx
// ✅ Variants + className for layout tweaks
import { Button } from '@gideon-defender/ui/button';
import { Badge } from '@gideon-defender/ui/badge';

<Button variant="destructive">Delete</Button>
<Button variant="outline" size="lg">
  Large Outline
</Button>
<Badge variant="secondary">Status</Badge>
<Button className="w-full">Full Width</Button>
```

## ✅ ALWAYS Do This

```tsx
// Use component variants
<Button variant="destructive">Delete</Button>
<Button variant="outline" size="lg">
  Large Outline
</Button>
<Badge variant="secondary">Status</Badge>

// Use className for one-off layout adjustments (merged via cn())
<Button className="w-full">Full Width</Button>
<div className="flex items-center gap-4">
  <Button>First</Button>
  <Button>Second</Button>
</div>
```

## Layout & Positioning

For layout concerns (width, grid positioning, margins), use Tailwind utilities directly or wrapper elements:

```tsx
// ✅ className directly on @gideon-defender/ui components
import { Button } from '@gideon-defender/ui/button';
import { Card } from '@gideon-defender/ui/card';

<Button className="w-full">Full Width</Button>;

// ✅ Grid/flex positioning with wrapper
<div className="col-span-2">
  <Card>Spanning Card</Card>
</div>;

// ✅ Flex for spacing
<div className="flex items-center gap-4">
  <Button>First</Button>
  <Button>Second</Button>
</div>;
```

## If a Variant Doesn't Exist

1. **Check the component file** in `packages/ui/src/components/` - it might exist and you missed it
2. **Add a new variant** to the component's `cva` definition
3. **Create a new component** if it's a genuinely new pattern

```tsx
// Example: Adding a variant to button.tsx
const buttonVariants = cva('...base classes...', {
  variants: {
    variant: {
      // existing variants...
      newVariant: 'bg-teal-500 text-white hover:bg-teal-600', // ADD HERE
    },
  },
});
```

## Import Pattern

`@gideon-defender/ui` uses per-component subpath imports:

```tsx
import { Button } from '@gideon-defender/ui/button';
import { Card, CardHeader, CardContent } from '@gideon-defender/ui/card';
import { Badge } from '@gideon-defender/ui/badge';
import { Input } from '@gideon-defender/ui/input';
import { Sheet, SheetContent, SheetHeader } from '@gideon-defender/ui/sheet';
```

## Icons

Use `lucide-react` for icons:

```tsx
// ✅ ALWAYS - Use lucide-react
import { Plus, Download, Settings, ChevronDown } from 'lucide-react';

<Plus className="h-4 w-4" />
<Download className="h-5 w-5" />

// ❌ NEVER - Don't add new @trycompai/design-system/icons (Carbon) imports
import { Add, Download, Settings, ChevronDown } from '@trycompai/design-system/icons';
```

When touching a file, migrate existing `@trycompai/design-system/icons` (Carbon) imports to `lucide-react` equivalents:

| @carbon/icons-react | lucide-react |
| ------------------- | ------------ |
| Add                 | Plus         |
| Close               | X            |
| Checkmark           | Check        |
| ChevronDown         | ChevronDown  |
| ChevronRight        | ChevronRight |
| Settings            | Settings     |
| TrashCan            | Trash        |
| Edit                | Pencil       |
| Search              | Search       |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
