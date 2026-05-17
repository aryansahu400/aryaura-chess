import { useState, useCallback, useRef } from 'react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChatState {
  conversationId: string | null;
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
}

export const useChat = () => {
  const [state, setState] = useState<ChatState>({
    conversationId: null,
    messages: [],
    isLoading: false,
    error: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const startConversation = useCallback(async () => {
    try {
      const response = await fetch('/chat/start');
      const conversationId = await response.text();
      setState(prev => ({
        ...prev,
        conversationId: conversationId.trim(),
        messages: [],
        error: null,
      }));
      return conversationId.trim();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to start conversation';
      setState(prev => ({
        ...prev,
        error: errorMsg,
      }));
      throw err;
    }
  }, []);

  const sendMessage = useCallback(
    async (prompt: string, fen?: string) => {
      if (!state.conversationId) {
        setState(prev => ({
          ...prev,
          error: 'No active conversation',
        }));
        return;
      }

      // Add user message
      const userMessageId = Date.now().toString();
      setState(prev => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: userMessageId,
            role: 'user',
            content: prompt,
            timestamp: Date.now(),
          },
        ],
        isLoading: true,
        error: null,
      }));

      try {
        abortControllerRef.current = new AbortController();

        const response = await fetch('/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            conversationId: state.conversationId,
            prompt,
            ...(fen && { fen }),
          }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`Chat error: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Streaming not supported');
        }

        const decoder = new TextDecoder();
        let assistantContent = '';
        const assistantMessageId = (Date.now() + 1).toString();

        // Add initial empty assistant message
        setState(prev => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              id: assistantMessageId,
              role: 'assistant',
              content: '',
              timestamp: Date.now(),
            },
          ],
        }));

        let buffer = '';
        let done = false;

        while (!done) {
          const { value, done: streamDone } = await reader.read();
          done = streamDone;

          if (value) {
            const chunk = decoder.decode(value, { stream: !streamDone });
            buffer += chunk;

            // Process complete lines
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep last incomplete line in buffer

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              // Handle SSE format: data: content
              if (trimmed.startsWith('data: ')) {
                const content = trimmed.substring(6); // Remove "data: " prefix

                if (content === '[DONE]') {
                  done = true;
                } else if (content) {
                  assistantContent += content + ' ';

                  // Update the assistant message in real-time
                  setState(prev => ({
                    ...prev,
                    messages: prev.messages.map(msg =>
                      msg.id === assistantMessageId
                        ? { ...msg, content: assistantContent.trimEnd() }
                        : msg
                    ),
                  }));
                }
              }
            }
          }
        }

        // Process any remaining data in buffer
        if (buffer.trim()) {
          const trimmed = buffer.trim();
          if (trimmed.startsWith('data: ')) {
            const content = trimmed.substring(6);
            if (content && content !== '[DONE]') {
              assistantContent += content + ' ';
              setState(prev => ({
                ...prev,
                messages: prev.messages.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, content: assistantContent.trimEnd() }
                    : msg
                ),
              }));
            }
          }
        }

        setState(prev => ({
          ...prev,
          isLoading: false,
        }));
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return; // User cancelled
        }
        const errorMsg = err instanceof Error ? err.message : 'Failed to send message';
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: errorMsg,
        }));
      }
    },
    [state.conversationId]
  );

  const clearConversation = useCallback(async () => {
    if (!state.conversationId) return;

    try {
      await fetch(`/chat/${state.conversationId}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.error('Failed to clear conversation:', err);
    }

    setState({
      conversationId: null,
      messages: [],
      isLoading: false,
      error: null,
    });
  }, [state.conversationId]);

  const newChat = useCallback(async () => {
    if (state.conversationId) {
      await clearConversation();
    }
    await startConversation();
  }, [state.conversationId, clearConversation, startConversation]);

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  return {
    ...state,
    startConversation,
    sendMessage,
    clearConversation,
    newChat,
    stopStreaming,
  };
};
