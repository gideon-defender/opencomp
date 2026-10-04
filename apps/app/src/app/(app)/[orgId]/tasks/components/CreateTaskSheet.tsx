'use client';

import { DepartmentSelect } from '@/components/DepartmentSelect';
import { SelectAssignee } from '@/components/SelectAssignee';
import { useTaskTemplates } from '@/hooks/use-task-template-api';
import { Member, TaskFrequency, User } from '@db';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@gideon-defender/ui/form';
import { useMediaQuery } from '@gideon-defender/ui/hooks';
import MultipleSelector, { Option } from '@gideon-defender/ui/multiple-selector';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Textarea,
} from '@trycompai/design-system';
import { ArrowRight } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { taskFrequencies } from '../[taskId]/components/constants';

const createCreateTaskSchema = (t: ReturnType<typeof useTranslations<'tasks'>>) =>
  z.object({
    title: z.string().min(1, {
      message: t('createSheet.titleRequired'),
    }),
    description: z.string().min(1, {
      message: t('createSheet.descriptionRequired'),
    }),
    assigneeId: z.string().nullable().optional(),
    frequency: z.nativeEnum(TaskFrequency).nullable().optional(),
    department: z
      .string()
      .trim()
      .max(64, { message: t('createSheet.departmentMaxLength') })
      .nullable()
      .optional(),
    controlIds: z.array(z.string()).optional(),
    taskTemplateId: z.string().nullable().optional(),
  });

type CreateTaskFormValues = z.infer<ReturnType<typeof createCreateTaskSchema>>;

interface CreateTaskPayload {
  title: string;
  description: string;
  assigneeId?: string | null;
  frequency?: string | null;
  department?: string | null;
  controlIds?: string[];
  taskTemplateId?: string | null;
}

interface CreateTaskSheetProps {
  members: (Member & { user: User })[];
  controls: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  createTask: (data: CreateTaskPayload) => Promise<void>;
}

export function CreateTaskSheet({
  members,
  controls,
  open,
  onOpenChange,
  createTask,
}: CreateTaskSheetProps) {
  const t = useTranslations('tasks');
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: taskTemplates } = useTaskTemplates();

  const schema = useMemo(() => createCreateTaskSchema(t), [t]);

  const form = useForm<CreateTaskFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      description: '',
      assigneeId: null,
      frequency: null,
      department: null,
      controlIds: [],
      taskTemplateId: null,
    },
  });

  const onSubmit = useCallback(
    async (data: CreateTaskFormValues) => {
      setIsSubmitting(true);
      try {
        await createTask({
          title: data.title,
          description: data.description,
          assigneeId: data.assigneeId,
          frequency: data.frequency,
          department: data.department,
          controlIds: data.controlIds,
          taskTemplateId: data.taskTemplateId,
        });
        toast.success(t('createSheet.createdToast'));
        onOpenChange(false);
        form.reset();
      } catch {
        toast.error(t('createSheet.createFailedToast'));
      } finally {
        setIsSubmitting(false);
      }
    },
    [createTask, onOpenChange, form, t],
  );

  // Memoize control options to prevent re-renders
  const controlOptions = useMemo(
    () =>
      controls.map((control) => ({
        value: control.id,
        label: control.name,
      })),
    [controls],
  );

  const frameworkEditorTaskTemplates = useMemo(() => taskTemplates?.data || [], [taskTemplates]);

  // Watch for task template selection
  // eslint-disable-next-line react-hooks/incompatible-library -- RHF watch() is not memoizable by React Compiler
  const selectedTaskTemplateId = form.watch('taskTemplateId');
  const selectedTaskTemplate = useMemo(
    () => frameworkEditorTaskTemplates.find((template) => template.id === selectedTaskTemplateId),
    [selectedTaskTemplateId, frameworkEditorTaskTemplates],
  );

  // Auto-fill form when task template is selected
  useEffect(() => {
    if (selectedTaskTemplate) {
      form.setValue('title', selectedTaskTemplate.name);
      form.setValue('description', selectedTaskTemplate.description);
      form.setValue('frequency', selectedTaskTemplate.frequency as TaskFrequency);
      form.setValue('department', selectedTaskTemplate.department ?? null);
    }
  }, [selectedTaskTemplate, form]);

  // Memoize filter function to prevent re-renders
  const filterFunction = useCallback(
    (value: string, search: string) => {
      // Find the option with this value (control ID)
      const option = controlOptions.find((opt) => opt.value === value);
      if (!option) return 0;

      // Check if the control name (label) contains the search string
      return option.label.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
    },
    [controlOptions],
  );

  // Memoize select handlers
  const handleFrequencyChange = useCallback(
    (value: string | null, onChange: (value: any) => void) => {
      onChange(!value || value === 'none' ? null : value);
    },
    [],
  );

  const handleControlsChange = useCallback((options: Option[], onChange: (value: any) => void) => {
    onChange(options.map((option) => option.value));
  }, []);

  const handleTaskTemplateChange = useCallback(
    (value: string | null, onChange: (value: any) => void) => {
      if (!value || value === 'none') {
        onChange(null);
        // Clear the fields when "none" is selected
        form.setValue('title', '');
        form.setValue('description', '');
        form.setValue('frequency', null);
        form.setValue('department', null);
      } else {
        onChange(value);
      }
    },
    [form],
  );

  const taskForm = (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 w-full max-w-none">
        <FormField
          control={form.control}
          name="taskTemplateId"
          render={({ field }) => {
            const selectedTemplate = frameworkEditorTaskTemplates.find((t) => t.id === field.value);
            return (
              <FormItem className="w-full">
                <FormLabel>{t('createSheet.templateLabel')}</FormLabel>
                <Select
                  value={field.value || 'none'}
                  onValueChange={(value) => handleTaskTemplateChange(value, field.onChange)}
                >
                  <SelectTrigger>
                    {selectedTemplate?.name || t('createSheet.selectTemplate')}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('createSheet.none')}</SelectItem>
                    {frameworkEditorTaskTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            );
          }}
        />

        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem className="w-full">
              <FormLabel>{t('createSheet.titleLabel')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder={t('createSheet.titlePlaceholder')}
                  autoCorrect="off"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem className="w-full">
              <FormLabel>{t('createSheet.descriptionLabel')}</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  placeholder={t('createSheet.descriptionPlaceholder')}
                  rows={4}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="assigneeId"
          render={({ field }) => (
            <FormItem className="w-full">
              <FormLabel>{t('createSheet.assigneeLabel')}</FormLabel>
              <FormControl>
                <div className="w-full">
                  <SelectAssignee
                    assignees={members}
                    assigneeId={field.value ?? null}
                    onAssigneeChange={field.onChange}
                    withTitle={false}
                  />
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="frequency"
          render={({ field }) => {
            const displayValue = field.value
              ? field.value.replace('_', ' ')
              : t('createSheet.selectFrequency');
            return (
              <FormItem className="w-full">
                <FormLabel>{t('createSheet.frequencyLabel')}</FormLabel>
                <Select
                  value={field.value || 'none'}
                  onValueChange={(value) => handleFrequencyChange(value, field.onChange)}
                >
                  <SelectTrigger>
                    <span className="capitalize">{displayValue}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('createSheet.none')}</SelectItem>
                    {taskFrequencies.map((frequency) => (
                      <SelectItem key={frequency} value={frequency}>
                        <span className="capitalize">{frequency.replace('_', ' ')}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            );
          }}
        />

        <FormField
          control={form.control}
          name="department"
          render={({ field }) => (
            <FormItem className="w-full">
              <FormLabel>{t('createSheet.departmentLabel')}</FormLabel>
              <FormControl>
                <DepartmentSelect
                  value={field.value || 'none'}
                  onChange={(value) => field.onChange(value === 'none' ? null : value)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="controlIds"
          render={({ field }) => {
            // Convert current field value to selected options (computed inline since it depends on field.value)
            const selectedOptions: Option[] = (field.value || [])
              .map((id) => {
                const control = controls.find((c) => c.id === id);
                return control ? { value: control.id, label: control.name } : null;
              })
              .filter(Boolean) as Option[];

            return (
              <FormItem className="w-full">
                <FormLabel>{t('createSheet.controlsLabel')}</FormLabel>
                <FormControl>
                  <div className="relative overflow-visible">
                    <MultipleSelector
                      value={selectedOptions}
                      onChange={(options) => handleControlsChange(options, field.onChange)}
                      defaultOptions={controlOptions}
                      placeholder={t('createSheet.controlsPlaceholder')}
                      emptyIndicator={
                        <p className="text-center text-lg leading-10 text-muted-foreground">
                          {t('createSheet.noControlsFound')}
                        </p>
                      }
                      className="[&_[cmdk-list]]:!z-[9999] [&_[cmdk-list]]:!absolute [&_.relative]:!static"
                      commandProps={{
                        filter: filterFunction,
                      }}
                    />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            );
          }}
        />

        <div className="flex justify-end pt-4">
          <Button
            type="submit"
            disabled={isSubmitting}
            loading={isSubmitting}
            iconRight={<ArrowRight size={16} />}
          >
            {t('createSheet.submit')}
          </Button>
        </div>
      </form>
    </Form>
  );

  if (isDesktop) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{t('createSheet.title')}</SheetTitle>
          </SheetHeader>
          <SheetBody>{taskForm}</SheetBody>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{t('createSheet.title')}</DrawerTitle>
        </DrawerHeader>
        <div className="p-4">{taskForm}</div>
      </DrawerContent>
    </Drawer>
  );
}
