'use client';

import { useApi } from '@/hooks/use-api';
import { useApiSWR, UseApiSWROptions } from '@/hooks/use-api-swr';
import type { AttachmentType } from '@db';
import { useCallback } from 'react';

// Types for attachments API
// Note: API returns dates as ISO strings, not Date objects
interface Attachment {
  id: string;
  name: string;
  type: AttachmentType;
  url: string;
  createdAt: string; // ISO string from API
  updatedAt: string; // ISO string from API
  entityId: string;
  entityType: string;
  organizationId: string;
  commentId: string | null;
  description: string | null;
}

/**
 * Hook to fetch task attachments using SWR
 */
export function useTaskAttachments(
  taskId: string | null,
  options: UseApiSWROptions<Attachment[]> = {},
) {
  return useApiSWR<Attachment[]>(taskId ? `/v1/tasks/${taskId}/attachments` : null, options);
}

/**
 * Hook for task attachment actions (upload, download, delete)
 */
export function useTaskAttachmentActions(taskId: string) {
  const api = useApi();

  const uploadAttachment = useCallback(
    (file: File): Promise<Attachment> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const base64String = reader.result as string;
            const base64Data = base64String.split(',')[1]; // Remove data:image/...;base64, prefix

            const response = await api.post<Attachment>(`/v1/tasks/${taskId}/attachments`, {
              fileName: file.name,
              fileType: file.type || 'application/octet-stream',
              fileData: base64Data,
            });

            if (response.error) {
              throw new Error(response.error);
            }

            resolve(response.data!);
          } catch (error) {
            reject(error);
          }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
    },
    [api, taskId],
  );

  const getDownloadUrl = useCallback(
    async (attachmentId: string) => {
      const response = await api.get<{ downloadUrl: string }>(
        `/v1/tasks/${taskId}/attachments/${attachmentId}/download`,
      );
      if (response.error) {
        throw new Error(response.error);
      }
      return response.data!.downloadUrl;
    },
    [api, taskId],
  );

  const deleteAttachment = useCallback(
    async (attachmentId: string) => {
      const response = await api.delete(`/v1/tasks/${taskId}/attachments/${attachmentId}`);
      if (response.error) {
        throw new Error(response.error);
      }
      // DELETE returns 204 No Content - success if no error
      return { success: true, status: response.status };
    },
    [api, taskId],
  );

  return {
    uploadAttachment,
    getDownloadUrl,
    deleteAttachment,
  };
}
