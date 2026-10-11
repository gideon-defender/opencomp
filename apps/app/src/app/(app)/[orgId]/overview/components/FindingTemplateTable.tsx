'use client';

import type { FindingTemplate } from '@/hooks/use-findings-api';
import { Badge } from '@gideon-defender/ui/badge';
import { Button } from '@gideon-defender/ui/button';
import { Input } from '@gideon-defender/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@gideon-defender/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gideon-defender/ui/table';
import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { CATEGORY_LABEL_KEYS, TEMPLATE_CATEGORIES } from './finding-template-categories';

const PAGE_SIZE = 10;

interface FindingTemplateTableProps {
  templates: FindingTemplate[];
  isDeleting: boolean;
  onEdit: (template: FindingTemplate) => void;
  onDelete: (template: FindingTemplate) => void;
}

export function FindingTemplateTable({
  templates,
  isDeleting,
  onEdit,
  onDelete,
}: FindingTemplateTableProps) {
  const t = useTranslations('overview');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return templates.filter((template) => {
      if (categoryFilter !== 'all' && template.category !== categoryFilter) {
        return false;
      }
      if (!query) return true;
      return (
        template.title.toLowerCase().includes(query) ||
        template.content.toLowerCase().includes(query)
      );
    });
  }, [templates, search, categoryFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const categoryLabel = (category: string) => {
    const key = CATEGORY_LABEL_KEYS[category];
    return key ? t(key) : category;
  };

  return (
    <>
      <div className="flex flex-col gap-2 md:flex-row">
        <div className="w-full md:max-w-[260px]">
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t('findings.templateSearchPlaceholder')}
          />
        </div>
        <div className="w-full md:w-[200px]">
          <Select
            value={categoryFilter}
            onValueChange={(value) => {
              setCategoryFilter(value ?? 'all');
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('findings.templateAllCategories')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('findings.templateAllCategories')}</SelectItem>
              {TEMPLATE_CATEGORIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(CATEGORY_LABEL_KEYS[value])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {templates.length === 0
            ? t('findings.noOrgTemplates')
            : t('findings.noTemplatesMatchFilter')}
        </p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('findings.templateColTitle')}</TableHead>
                <TableHead>{t('findings.templateColCategory')}</TableHead>
                <TableHead>{t('findings.templateColContent')}</TableHead>
                <TableHead>{t('findings.templateColOrder')}</TableHead>
                <TableHead>{t('findings.templateColActions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.map((template) => {
                const editable = template.organizationId !== null;
                return (
                  <TableRow key={template.id}>
                    <TableCell>
                      <span className="block text-sm font-medium">{template.title}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{categoryLabel(template.category)}</Badge>
                      {!editable && (
                        <Badge variant="secondary" className="ml-1">
                          {t('findings.globalTemplateBadge')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="block max-w-[280px] truncate text-sm text-muted-foreground">
                        {template.content}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{template.order}</span>
                    </TableCell>
                    <TableCell>
                      {editable && (
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onEdit(template)}
                            aria-label={t('findings.editTemplate')}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isDeleting}
                            onClick={() => onDelete(template)}
                            aria-label={t('findings.deleteTemplate')}
                          >
                            {t('findings.deleteTemplate')}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {filtered.length > PAGE_SIZE && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {t('findings.templatePaginationRange', {
                  from: pageStart + 1,
                  to: Math.min(pageStart + PAGE_SIZE, filtered.length),
                  total: filtered.length,
                })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t('findings.templatePrevious')}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {t('findings.templatePageInfo', {
                    current: currentPage,
                    total: totalPages,
                  })}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  {t('findings.templateNext')}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
