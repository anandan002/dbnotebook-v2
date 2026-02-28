import { useRef, useEffect } from 'react';
import { MessageBubble } from './MessageBubble';
import { MessageSquare, Sparkles, FileText, Search, Lightbulb, BookOpen, Zap, RefreshCw } from 'lucide-react';
import { useAgentSuggestions } from '../../hooks';
import type { Message } from '../../types';

interface MessageListProps {
  messages: Message[];
  onCopy?: (content: string) => void;
  onSuggestionClick?: (suggestion: string) => void;
  hasNotebook?: boolean;
  hasDocuments?: boolean;
  notebookId?: string;
  notebookName?: string;
}

export function MessageList({
  messages,
  onCopy,
  onSuggestionClick,
  hasNotebook = false,
  hasDocuments = false,
  notebookId,
  notebookName,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  if (messages.length === 0) {
    return (
      <EmptyState
        onSuggestionClick={onSuggestionClick}
        hasNotebook={hasNotebook}
        hasDocuments={hasDocuments}
        notebookId={notebookId}
        notebookName={notebookName}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto overflow-x-hidden"
    >
      <div className="max-w-3xl mx-auto">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onCopy={onCopy}
            notebookId={notebookId}
          />
        ))}
        <div ref={bottomRef} className="h-4" />
      </div>
    </div>
  );
}

interface EmptyStateProps {
  onSuggestionClick?: (suggestion: string) => void;
  hasNotebook?: boolean;
  hasDocuments?: boolean;
  notebookId?: string;
  notebookName?: string;
}

function EmptyState({ onSuggestionClick, hasNotebook, hasDocuments, notebookId, notebookName }: EmptyStateProps) {
  // Fetch dynamic suggestions when we have documents
  const { suggestions: dynamicSuggestions, isLoading, refresh } = useAgentSuggestions({
    notebookId,
    enabled: hasDocuments && !!notebookId,
  });

  // Context-aware suggestions based on state
  const getStaticSuggestions = () => {
    if (hasNotebook && hasDocuments) {
      return documentSuggestions;
    } else if (hasNotebook) {
      return notebookSuggestions;
    }
    return generalSuggestions;
  };

  const getContextMessage = () => {
    if (hasNotebook && hasDocuments) {
      return `Ask questions about your documents in "${notebookName}"`;
    } else if (hasNotebook) {
      return 'Upload documents to get started with RAG-powered Q&A';
    }
    return 'Select a notebook or start a general conversation';
  };

  // Use dynamic suggestions if available, otherwise fall back to static
  const hasDynamicSuggestions = dynamicSuggestions.length > 0;
  const staticSuggestions = getStaticSuggestions();

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
      <div className="text-center max-w-xl">
        {/* Simple icon - no heavy animations */}
        <div className="mb-6">
          <div className="w-14 h-14 mx-auto rounded-xl bg-glow/10 flex items-center justify-center">
            {hasDocuments ? (
              <BookOpen className="w-7 h-7 text-glow" />
            ) : hasNotebook ? (
              <FileText className="w-7 h-7 text-text-muted" />
            ) : (
              <MessageSquare className="w-7 h-7 text-text-muted" />
            )}
          </div>
        </div>

        {/* Title */}
        <h2 className="text-xl font-semibold text-text mb-2 font-[family-name:var(--font-display)]">
          {hasDocuments ? 'Ready to chat' : hasNotebook ? 'No documents yet' : 'Welcome'}
        </h2>

        {/* Context message */}
        <p className="text-sm text-text-muted mb-6">
          {getContextMessage()}
        </p>

        {/* AI-powered suggestions header - only show when we have documents */}
        {hasDocuments && (
          <div className="flex items-center justify-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-glow" />
            <span className="text-xs font-medium text-glow uppercase tracking-wider">
              {isLoading ? 'Loading suggestions...' : 'Suggested questions'}
            </span>
            {hasDynamicSuggestions && (
              <button
                onClick={refresh}
                className="p-1 rounded hover:bg-void-surface transition-colors"
                title="Refresh suggestions"
              >
                <RefreshCw className="w-3 h-3 text-text-dim hover:text-glow" />
              </button>
            )}
          </div>
        )}

        {/* Loading state */}
        {isLoading && hasDocuments && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-20 rounded-lg bg-void-surface/50 border border-void-lighter animate-pulse"
              />
            ))}
          </div>
        )}

        {/* Dynamic AI suggestions */}
        {!isLoading && hasDynamicSuggestions && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {dynamicSuggestions.map((suggestion, index) => (
              <button
                key={index}
                onClick={() => onSuggestionClick?.(suggestion.text)}
                className="group flex items-start gap-3 p-4 rounded-lg bg-gradient-to-br from-glow/5 to-transparent border border-glow/20 text-left hover:border-glow/40 hover:from-glow/10 transition-all"
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-glow/10 group-hover:bg-glow/20 flex items-center justify-center transition-colors">
                  <Zap className="w-4 h-4 text-glow" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-text block leading-snug">
                    {suggestion.text}
                  </span>
                  {suggestion.reason && (
                    <span className="text-xs text-text-dim mt-1 block">
                      {suggestion.reason}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Static suggestion cards - fallback or when no documents */}
        {(!hasDynamicSuggestions || !hasDocuments) && !isLoading && (
          <div className="grid grid-cols-2 gap-2">
            {staticSuggestions.map((suggestion, index) => (
              <button
                key={index}
                onClick={() => onSuggestionClick?.(suggestion.text)}
                className="group flex items-start gap-3 p-3 rounded-lg bg-void-surface/50 border border-void-lighter text-left hover:border-glow/30 hover:bg-void-surface transition-all"
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-void-lighter group-hover:bg-glow/10 flex items-center justify-center transition-colors">
                  <suggestion.icon className="w-4 h-4 text-text-dim group-hover:text-glow transition-colors" />
                </div>
                <div className="min-w-0">
                  <span className="text-sm font-medium text-text block">{suggestion.label}</span>
                  <span className="text-xs text-text-dim truncate block">{suggestion.text}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Context-specific suggestions
const documentSuggestions = [
  { icon: Search, label: 'Find', text: 'What are the key insights?' },
  { icon: FileText, label: 'Summarize', text: 'Summarize the main points' },
  { icon: Sparkles, label: 'Create', text: 'Generate an infographic' },
  { icon: Lightbulb, label: 'Explain', text: 'Explain this in simple terms' },
];

const notebookSuggestions = [
  { icon: FileText, label: 'Upload', text: 'Drop files to add documents' },
  { icon: Search, label: 'Web', text: 'Search and import from web' },
  { icon: MessageSquare, label: 'Chat', text: 'Ask me anything' },
  { icon: Sparkles, label: 'Create', text: 'Generate content' },
];

const generalSuggestions = [
  { icon: MessageSquare, label: 'Chat', text: 'Ask me anything' },
  { icon: BookOpen, label: 'Notebook', text: 'Create a notebook first' },
  { icon: Sparkles, label: 'Create', text: 'Generate an image' },
  { icon: Lightbulb, label: 'Help', text: 'What can you do?' },
];

export default MessageList;
