'use client';

import { Button } from '@gideon-defender/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@gideon-defender/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@gideon-defender/ui/form';
import { Input } from '@gideon-defender/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gideon-defender/ui/select';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

const schema = z.object({
  environment: z.enum(['sandbox', 'production']),
  accountId: z.string().trim().min(1, 'Account ID is required').max(100),
  package: z.string().trim().min(1, 'Package slug is required').max(100),
  node: z.string().trim().max(100).optional(),
  apiKey: z.string().trim().min(1, 'API key is required').max(500),
});

type ConfigureCheckrValues = z.infer<typeof schema>;

const defaults: ConfigureCheckrValues = {
  environment: 'production',
  accountId: '',
  package: '',
  node: '',
  apiKey: '',
};

export function ConfigureCheckrDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const form = useForm<ConfigureCheckrValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  const handleSubmit = async (values: ConfigureCheckrValues) => {
    try {
      const response = await fetch('/api/checkr/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ ...values, organizationId, node: values.node || undefined }),
      });
      const data: { error?: string } = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(data.error ?? 'Checkr configuration failed. Try again.');
        return;
      }
      form.reset(defaults);
      onOpenChange(false);
      toast.success('Checkr account configured. Intake is ready.');
      router.refresh();
    } catch {
      toast.error('Checkr configuration failed. Try again.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Configure Checkr</DialogTitle>
          <DialogDescription>
            Connect this tenant&apos;s exclusive Checkr account. The API key is stored encrypted and
            never shown again. Saving verifies the account with Checkr before enabling intake.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="environment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Environment</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select environment" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="production">Production</SelectItem>
                      <SelectItem value="sandbox">Sandbox</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="accountId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Checkr account ID</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Checkr account ID" autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="package"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Package slug</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="e.g. tasker_standard" autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="node"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Hierarchy node <span className="text-muted-foreground">(optional)</span>
                  </FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Node custom ID" autoComplete="off" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Checkr API key</FormLabel>
                  <FormControl>
                    <Input {...field} type="password" autoComplete="new-password" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={form.formState.isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save configuration
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
