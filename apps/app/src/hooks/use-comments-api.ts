'use client';

import { useApi } from '@/hooks/use-api';
import { useApiSWR, UseApiSWROptions } from '@/hooks/use-api-swr';
import type { CommentEntityType } from '@db';
import { useCallback } from 'react';

// Types for the new generic comments API
// Note: API returns dates as ISO strings, not Date objects
interface Comment {
  id: string;
  content: string;
  author: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    deactivated: boolean;
  };
  attachments: Array<{
    id: string;
    name: string;
    type: string;
    downloadUrl: string;
    createdAt: string; // ISO string from API
  }>;
  createdAt: string; // ISO string from API
}

interface CreateCommentData {
  content: string;
  entityId: string;
  entityType: CommentEntityType;
  contextUrl?: string;
  attachments?: Array<{
    fileName: string;
    fileType: string;
    fileData: string; // base64
  }>;
}

interface UpdateCommentData {
  content: string;
  contextUrl?: string;
}

// Default polling interval for real-time updates (5 seconds)
const DEFAULT_COMMENTS_POLLING_INTERVAL = 5000;

interface UseCommentsOptions extends UseApiSWROptions<Comment[]> {
  /** Organization ID - MUST be passed to ensure correct org context */
  organizationId?: string;
}

/**
 * Generic hook to fetch comments for any entity using SWR
 * Includes polling for real-time updates (e.g., when local-trigger tasks create comments)
 *
 * IMPORTANT: Always pass organizationId from URL params to ensure correct org context
 * when user navigates to a different org's page while active org is different.
 */
export function useComments(
  entityId: string | null,
  entityType: CommentEntityType | null,
  options: UseCommentsOptions = {},
) {
  const endpoint =
    entityId && entityType ? `/v1/comments?entityId=${entityId}&entityType=${entityType}` : null;

  return useApiSWR<Comment[]>(endpoint, {
    ...options,
    // Enable polling for real-time updates (when local-trigger tasks create comments)
    refreshInterval: options.refreshInterval ?? DEFAULT_COMMENTS_POLLING_INTERVAL,
  });
}

/**
 * Generic hook for comment CRUD operations
 */
export function useCommentActions() {
  const api = useApi();

  const createComment = useCallback(
    async (data: CreateCommentData) => {
      const response = await api.post<Comment>('/v1/comments', {
        ...data,
        contextUrl:
          data.contextUrl ?? (typeof window !== 'undefined' ? window.location.href : undefined),
      });
      if (response.error) {
        throw new Error(response.error);
      }
      return response.data!;
    },
    [api],
  );

  const updateComment = useCallback(
    async (commentId: string, data: UpdateCommentData) => {
      const response = await api.put<Comment>(`/v1/comments/${commentId}`, {
        ...data,
        contextUrl:
          data.contextUrl ?? (typeof window !== 'undefined' ? window.location.href : undefined),
      });
      if (response.error) {
        throw new Error(response.error);
      }
      return response.data!;
    },
    [api],
  );

  const deleteComment = useCallback(
    async (commentId: string) => {
      const response = await api.delete(`/v1/comments/${commentId}`);
      if (response.error) {
        throw new Error(response.error);
      }
      // DELETE returns 204 No Content - success if no error
      return { success: true, status: response.status };
    },
    [api],
  );

  return {
    createComment,
    updateComment,
    deleteComment,
  };
}

/**
 * Utility hook that combines file handling with comment creation
 */
export function useCommentWithAttachments() {
  // Note: useCommentActions uses useApi which gets orgId from URL params
  // The options.organizationId is accepted for API consistency but not currently used
  // since useApi already handles org context from URL
  const { createComment } = useCommentActions();

  const createCommentWithFiles = useCallback(
    async (content: string, entityId: string, entityType: CommentEntityType, files: File[]) => {
      const attachments = await Promise.all(
        files.map((file) => {
          return new Promise<{ fileName: string; fileType: string; fileData: string }>(
            (resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64Data = (reader.result as string)?.split(',')[1];
                if (!base64Data) {
                  reject(new Error('Failed to read file data'));
                } else {
                  resolve({
                    fileName: file.name,
                    fileType: file.type,
                    fileData: base64Data,
                  });
                }
              };
              reader.onerror = () => reject(new Error('Failed to read file'));
              reader.readAsDataURL(file);
            },
          );
        }),
      );

      return createComment({
        content,
        entityId,
        entityType,
        contextUrl: typeof window !== 'undefined' ? window.location.href : undefined,
        attachments,
      });
    },
    [createComment],
  );

  return {
    createCommentWithFiles,
  };
}

// ==================== ENTITY-SPECIFIC CONVENIENCE HOOKS ====================

/**
 * Convenience hook for task comments
 */
export function useTaskComments(taskId: string | null, options: UseCommentsOptions = {}) {
  return useComments(taskId, 'task', options);
}

/**
 * Convenience hook for policy comments
 */
export function usePolicyComments(policyId: string | null, options: UseCommentsOptions = {}) {
  return useComments(policyId, 'policy', options);
}

/**
 * Example usage:
 *
 * ```typescript
 * function TaskComments({ taskId }: { taskId: string }) {
 *   const { data: comments, error, isLoading, mutate } = useTaskComments(taskId);
 *   const { createCommentWithFiles } = useCommentWithAttachments();
 *
 *   const handleSubmit = async (content: string, files: File[]) => {
 *     await createCommentWithFiles(content, taskId, 'task', files);
 *     mutate(); // Refresh comments
 *   };
 *
 *   if (isLoading) return <div>Loading...</div>;
 *   if (error || comments?.error) return <div>Error loading comments</div>;
 *
 *   return (
 *     <div>
 *       {comments?.data?.map(comment => (
 *         <div key={comment.id}>{comment.content}</div>
 *       ))}
 *     </div>
 *   );
 * }
 *
 * // For other entities:
 * function PolicyComments({ policyId }: { policyId: string }) {
 *   const { data: comments } = usePolicyComments(policyId);
 *   const { createCommentWithFiles } = useCommentWithAttachments();
 *
 *   const handleSubmit = async (content: string, files: File[]) => {
 *     await createCommentWithFiles(content, policyId, 'policy', files);
 *   };
 *
 *   // ... component implementation
 * }
 * ```
 */
