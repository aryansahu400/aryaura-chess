import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Plus, 
  Send, 
  Loader2,
  AlertCircle,
  MessageSquare 
} from 'lucide-react';
import { useChat } from '../hooks/useChat';
import ReactMarkdown from 'react-markdown';

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentFen?: string;
}

export const ChatDrawer: React.FC<ChatDrawerProps> = ({ isOpen, onClose, currentFen }) => {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chat = useChat();

  // Initialize chat on first open
  useEffect(() => {
    if (isOpen && !chat.conversationId) {
      chat.startConversation();
    }
  }, [isOpen]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || chat.isLoading) return;

    const message = inputValue;
    setInputValue('');
    await chat.sendMessage(message, currentFen);
  };

  const handleNewChat = async () => {
    await chat.newChat();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-gradient-to-b from-slate-900 to-slate-950 shadow-2xl z-50 flex flex-col border-l border-slate-700"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-700 bg-slate-800/50">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-amber-400" />
                <h2 className="text-lg font-semibold text-white">Chess AI Assistant</h2>
              </div>
              <button
                onClick={onClose}
                className="p-1 hover:bg-slate-700 rounded-lg transition-colors"
                aria-label="Close chat"
              >
                <X className="w-5 h-5 text-slate-400 hover:text-white" />
              </button>
            </div>

            {/* Messages Container */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col">
              {chat.messages.length === 0 && !chat.isLoading ? (
                <div className="flex items-center justify-center h-full text-center">
                  <div className="space-y-3">
                    <MessageSquare className="w-12 h-12 text-slate-600 mx-auto" />
                    <p className="text-slate-400 text-sm">
                      Start a conversation about your chess games
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {chat.messages.map((message) => (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`flex gap-3 max-w-xs ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                        {/* Avatar */}
                        {message.role === 'assistant' && (
                          <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                            <MessageSquare className="w-5 h-5 text-amber-400" />
                          </div>
                        )}
                        
                        {/* Message Content */}
                        <div className={`flex-1 ${message.role === 'user' ? 'text-right' : 'text-left'}`}>
                          {message.role === 'assistant' && (
                            <p className="text-xs font-semibold text-amber-400 mb-1">Aryaura Chess</p>
                          )}
                          <div
                            className={`px-4 py-2 rounded-lg inline-block ${
                              message.role === 'user'
                                ? 'bg-blue-600 text-white rounded-br-none'
                                : 'bg-slate-700 text-slate-100 rounded-bl-none'
                            }`}
                          >
                            {message.role === 'user' ? (
                              <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                            ) : (
                              <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                                {message.content.split('\n').map((line, idx) => (
                                  <div key={idx}>{line}</div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}

                  {chat.isLoading && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex justify-start"
                    >
                      <div className="bg-slate-700 rounded-lg rounded-bl-none px-4 py-2">
                        <div className="flex gap-2 items-center">
                          <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                          <span className="text-sm text-slate-300">Thinking...</span>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              )}

              {chat.error && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg"
                >
                  <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                  <p className="text-sm text-red-300">{chat.error}</p>
                </motion.div>
              )}
            </div>

            {/* Input Area */}
            <div className="border-t border-slate-700 p-4 space-y-3 bg-slate-800/50">
              {/* New Chat Button */}
              <button
                onClick={handleNewChat}
                disabled={chat.isLoading}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="w-4 h-4" />
                <span className="text-sm">New Chat</span>
              </button>

              {/* Message Input */}
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder="Ask about moves, strategy..."
                  disabled={chat.isLoading || !chat.conversationId}
                  className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button
                  type="submit"
                  disabled={chat.isLoading || !inputValue.trim() || !chat.conversationId}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  {chat.isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </form>

              {/* Status */}
              {currentFen && (
                <p className="text-xs text-slate-400 text-center">
                  Using current board position as context
                </p>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
