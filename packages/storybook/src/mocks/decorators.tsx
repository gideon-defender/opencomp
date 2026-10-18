/**
 * Decorators for components that need a specific provider or route context.
 * The story generator references these by name (see DECORATORS in
 * scripts/build-full-storybook.ts).
 */
import type { Decorator } from '@storybook/react';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@gideon-defender/ui/dropdown-menu';
import { ResizablePanel, ResizablePanelGroup } from '@gideon-defender/ui/resizable';
import { Select, SelectContent, SelectTrigger } from '@gideon-defender/ui/select';
import { ToastProvider, ToastViewport } from '@gideon-defender/ui/toast';
import { SidebarProvider } from '../../../../apps/app/src/context/sidebar-context';
import { MockNavigationContext } from './next/navigation';

export function withRouteParams(params: Record<string, string>): Decorator {
  return (Story, context) => (
    <MockNavigationContext.Consumer>
      {(current) => (
        <MockNavigationContext.Provider value={{ ...current, params: { ...current.params, ...params } }}>
          <Story {...context} />
        </MockNavigationContext.Provider>
      )}
    </MockNavigationContext.Consumer>
  );
}

export const withSidebar: Decorator = (Story) => (
  <SidebarProvider>
    <Story />
  </SidebarProvider>
);

export const withDropdownMenu: Decorator = (Story) => (
  <DropdownMenu open>
    <DropdownMenuTrigger aria-label="Open menu" />
    <DropdownMenuContent>
      <Story />
    </DropdownMenuContent>
  </DropdownMenu>
);

export const withToast: Decorator = (Story) => (
  <ToastProvider>
    <Story />
    <ToastViewport />
  </ToastProvider>
);

/**
 * Sonner's `<Toaster />` only paints once something has been queued, so the
 * story raises a toast on mount.
 */
export const withSonnerToast: Decorator = (Story) => {
  useEffect(() => {
    const id = toast.success('Policy published', { description: 'Everyone has been notified.' });
    return () => {
      toast.dismiss(id);
    };
  }, []);
  return <Story />;
};

/**
 * A sized, positioned canvas for absolutely-positioned decorations (gradients,
 * overlays) that have no intrinsic size of their own.
 */
export const withCanvas: Decorator = (Story) => (
  <div className="bg-muted relative h-40 w-80 overflow-hidden rounded-md">
    <Story />
  </div>
);

export const withPanelGroup: Decorator = (Story) => (
  <ResizablePanelGroup direction="horizontal" className="h-40 w-full">
    <ResizablePanel defaultSize={50}>Panel A</ResizablePanel>
    <Story />
    <ResizablePanel defaultSize={50}>Panel B</ResizablePanel>
  </ResizablePanelGroup>
);

/** For components that render a table section (`<thead>`/`<tbody>`/`<tr>`). */
export const withTable: Decorator = (Story) => (
  <table className="w-full">
    <Story />
  </table>
);

/** For components that render bare `SelectItem`s. */
export const withSelect: Decorator = (Story) => (
  <Select open>
    <SelectTrigger aria-label="Open select" />
    <SelectContent>
      <Story />
    </SelectContent>
  </Select>
);
