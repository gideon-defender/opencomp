'use client';

import { Chat } from '@ai-sdk/react';
import { DataUIPart, DefaultChatTransport } from 'ai';
import { useParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { mutate } from 'swr';
import { type ChatUIMessage } from '../components/chat/types';
import { useTaskAutomationDataMapper } from './task-automation-store';
import { DataPart } from './types/data-parts';

interface ChatContextValue {
  chat: Chat<ChatUIMessage>;
  updateAutomationId: (newId: string) => void;
  automationIdRef: React.MutableRefObject<string>;
  resolvedAutomationId: string;
}

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

export function ChatProvider({
  children,
  initialMessages = [],
}: {
  children: ReactNode;
  initialMessages?: any[];
}) {
  const mapDataToState = useTaskAutomationDataMapper();

  const baseUrl = process.env.NEXT_PUBLIC_ENTERPRISE_API_URL;
  const url = `${baseUrl}/api/tasks-automations/chat`;

  const { automationId } = useParams<{ automationId: string }>();

  // Use ref to track the latest automation ID (important for ephemeral → real transition)
  // The ref is only read/written outside of render; components render from
  // resolvedAutomationId state below.
  const automationIdRef = useRef(automationId);

  // Render-safe mirror of the shared ref for use during render.
  const [resolvedAutomationId, setResolvedAutomationId] = useState(automationId);
  const [hasBeenManuallyUpdated, setHasBeenManuallyUpdated] = useState(false);
  const [prevAutomationIdParam, setPrevAutomationIdParam] = useState(automationId);
  if (prevAutomationIdParam !== automationId) {
    setPrevAutomationIdParam(automationId);
    if (!hasBeenManuallyUpdated) {
      setResolvedAutomationId(automationId);
    }
  }

  // Function to update automation ID (called when ephemeral becomes real)
  const updateAutomationId = useCallback((newId: string) => {
    automationIdRef.current = newId;
    setHasBeenManuallyUpdated(true);
    setResolvedAutomationId(newId);
  }, []);

  // Create Chat instance once with initial messages. The event callbacks capture
  // only stable values (no React refs), so nothing here can read a ref during render.
  // Chat history is persisted by consumers observing useChat status (see chat.tsx).
  const [chat] = useState(
    () =>
      new Chat<ChatUIMessage>({
        transport: new DefaultChatTransport({
          api: url,
        }),
        messages: initialMessages,
        onToolCall: () => mutate(`/api/auth/info`),
        onData: (data) => {
          mapDataToState(data as DataUIPart<DataPart>);
        },
        onError: (error) => {
          toast.error(`Communication error with the AI: ${error.message}`);
          console.error('Error sending message:', error);
        },
      }),
  );

  // Keep the shared ref in sync outside of render.
  useEffect(() => {
    if (!hasBeenManuallyUpdated) {
      automationIdRef.current = automationId;
    }
  }, [automationId, hasBeenManuallyUpdated]);

  return (
    <ChatContext.Provider
      value={{ chat, updateAutomationId, automationIdRef, resolvedAutomationId }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useSharedChatContext() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useSharedChatContext must be used within a ChatProvider');
  }
  return context;
}
