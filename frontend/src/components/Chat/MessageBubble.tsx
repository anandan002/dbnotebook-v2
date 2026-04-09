import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { User, Bot, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { Message, SourceCitation } from '../../types';
import { TimingBreakdown, V2_CHAT_STREAM_STAGES } from '../shared/TimingBreakdown';
import { FeedbackWidget } from './FeedbackWidget';

interface MessageBubbleProps {
  message: Message;
  onCopy?: (content: string) => void;
  notebookId?: string;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  onCopy,
  notebookId,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onCopy?.(message.content);
  };

  return (
    <div
      className={`
        group flex gap-3 px-4 py-4
        animate-[slide-up_0.3s_ease-out]
        ${isUser ? 'bg-void-light/50' : 'bg-transparent'}
      `}
    >
      {/* Avatar */}
      <div
        className={`
          flex-shrink-0 w-8 h-8 rounded-lg
          flex items-center justify-center
          ${isUser ? 'bg-nebula/20 text-nebula' : 'bg-glow/20 text-glow'}
        `}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Role label */}
        <div className="flex items-center gap-2 mb-1">
          <span
            className={`
              text-xs font-medium font-[family-name:var(--font-display)]
              ${isUser ? 'text-nebula-bright' : 'text-glow'}
            `}
          >
            {isUser ? 'You' : 'Assistant'}
          </span>
          <span className="text-xs text-text-dim">
            {formatTime(message.timestamp)}
          </span>
        </div>

        {/* Message content */}
        <div className="prose prose-invert max-w-none">
          {message.isStreaming && !message.content ? (
            <TypingIndicator />
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => (
                  <p className="text-text leading-relaxed mb-3 last:mb-0">
                    {children}
                  </p>
                ),
                code: ({ className, children, ...props }) => {
                  const isInline = !className;
                  return isInline ? (
                    <code
                      className="px-1.5 py-0.5 rounded bg-void-surface text-glow-bright font-[family-name:var(--font-code)] text-sm"
                      {...props}
                    >
                      {children}
                    </code>
                  ) : (
                    <code
                      className="block p-4 rounded-lg bg-void text-text font-[family-name:var(--font-code)] text-sm overflow-x-auto"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => (
                  <pre className="bg-void rounded-lg overflow-hidden my-3">
                    {children}
                  </pre>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc list-inside text-text space-y-1 my-2">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-inside text-text space-y-1 my-2">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="text-text">{children}</li>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-glow hover:text-glow-bright underline underline-offset-2"
                  >
                    {children}
                  </a>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-text">{children}</strong>
                ),
                em: ({ children }) => (
                  <em className="italic text-text-muted">{children}</em>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-glow/30 pl-4 my-3 text-text-muted italic">
                    {children}
                  </blockquote>
                ),
                h1: ({ children }) => (
                  <h1 className="text-xl font-bold text-text mt-4 mb-2 font-[family-name:var(--font-display)]">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-lg font-bold text-text mt-3 mb-2 font-[family-name:var(--font-display)]">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-base font-bold text-text mt-2 mb-1 font-[family-name:var(--font-display)]">
                    {children}
                  </h3>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto my-4">
                    <table className="min-w-full border-collapse border border-void-surface rounded-lg overflow-hidden">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-void-surface/50">{children}</thead>
                ),
                tbody: ({ children }) => (
                  <tbody className="divide-y divide-void-surface">{children}</tbody>
                ),
                tr: ({ children }) => (
                  <tr className="hover:bg-void-light/30 transition-colors">{children}</tr>
                ),
                th: ({ children }) => (
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-glow uppercase tracking-wider border-b border-void-surface">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="px-4 py-3 text-sm text-text border-r border-void-surface/50 last:border-r-0">
                    {children}
                  </td>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          )}
        </div>

        {/* Generated images */}
        {message.images && message.images.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {message.images.map((image, index) => (
              <div
                key={index}
                className="relative rounded-lg overflow-hidden border border-void-surface group/img"
              >
                <img
                  src={image}
                  alt={`Generated image ${index + 1}`}
                  className="w-full h-auto"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-void/50 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                  <a
                    href={image}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-lg bg-glow/20 text-glow text-sm hover:bg-glow/30"
                  >
                    View Full Size
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Source citations */}
        {!isUser && message.sources && message.sources.length > 0 && !message.isStreaming && (
          <SourceCitations sources={message.sources} />
        )}

        {/* Performance timings */}
        {!isUser && message.metadata?.timings && Object.keys(message.metadata.timings).length > 0 && !message.isStreaming && (
          <div className="mt-4">
            <TimingBreakdown
              totalTimeMs={message.metadata.execution_time_ms || 0}
              timings={message.metadata.timings}
              stages={V2_CHAT_STREAM_STAGES}
              title="Performance Timings"
              model={message.metadata.model}
            />
          </div>
        )}

        {/* Feedback widget — only for completed assistant messages with tracing enabled */}
        {!isUser &&
          !message.isStreaming &&
          message.content &&
          message.metadata?.trace_id &&
          message.metadata?.query_id &&
          notebookId && (
            <FeedbackWidget
              traceId={message.metadata.trace_id}
              queryId={message.metadata.query_id}
              notebookId={notebookId}
            />
          )}

        {/* Streaming indicator */}
        {message.isStreaming && message.content && (
          <span className="inline-block w-2 h-4 bg-glow ml-0.5 animate-[typing_0.8s_ease-in-out_infinite]" />
        )}
      </div>

      {/* Copy button */}
      {!isUser && message.content && !message.isStreaming && (
        <button
          onClick={handleCopy}
          className={`
            flex-shrink-0 p-2 rounded-lg
            opacity-0 group-hover:opacity-100
            transition-all duration-200
            hover:bg-void-surface
            ${copied ? 'text-success' : 'text-text-dim hover:text-text'}
          `}
          title="Copy to clipboard"
        >
          {copied ? (
            <Check className="w-4 h-4" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
      )}
    </div>
  );
});

function TypingIndicator() {
  return (
    <div className="flex items-center gap-3 py-3 px-4 rounded-lg bg-glow/5 border border-glow/10">
      <div className="streaming-dots flex items-center gap-1">
        <span />
        <span />
        <span />
      </div>
      <span className="text-sm text-glow font-medium">Generating response...</span>
    </div>
  );
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

interface SourceCitationsProps {
  sources: SourceCitation[];
}

function SourceCitations({ sources }: SourceCitationsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedSource, setSelectedSource] = useState<number | null>(null);

  return (
    <div className="mt-4 pt-3 border-t border-void-surface">
      {/* Compact chip view */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-text-muted">Sources:</span>
        {sources.map((source, index) => (
          <button
            key={index}
            onClick={() => setSelectedSource(selectedSource === index ? null : index)}
            className={`
              inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs
              transition-all duration-200 cursor-pointer
              ${selectedSource === index
                ? 'bg-glow/20 text-glow border border-glow/30'
                : 'bg-void-surface text-text-muted hover:bg-void-lighter hover:text-text border border-transparent'
              }
            `}
            title={source.snippet || source.filename}
          >
            <span className="w-4 h-4 rounded-full bg-nebula/20 text-nebula text-[10px] font-bold flex items-center justify-center">
              {index + 1}
            </span>
            <span className="max-w-[120px] truncate">{source.filename}</span>
            {source.page && (
              <span className="text-text-dim">p.{source.page}</span>
            )}
            {source.score && source.score > 0.8 && (
              <span className="w-1.5 h-1.5 rounded-full bg-success" title={`${Math.round(source.score * 100)}% match`} />
            )}
          </button>
        ))}

        {/* Toggle expand button */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs text-text-dim hover:text-glow hover:bg-void-surface transition-colors"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-3 h-3" />
              <span>Less</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              <span>Details</span>
            </>
          )}
        </button>
      </div>

      {/* Selected source detail (inline) */}
      {selectedSource !== null && !isExpanded && (
        <div className="mt-2 p-2 rounded-lg bg-void-surface/50 border border-glow/10 animate-[slide-up_0.2s_ease-out]">
          <div className="flex items-start gap-2">
            <div className="flex-shrink-0 w-5 h-5 rounded bg-nebula/20 text-nebula text-xs font-medium flex items-center justify-center">
              {selectedSource + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-text">{sources[selectedSource].filename}</span>
                {sources[selectedSource].page && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-void-lighter text-text-muted">
                    Page {sources[selectedSource].page}
                  </span>
                )}
                {sources[selectedSource].score && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-glow/10 text-glow">
                    {Math.round(sources[selectedSource].score * 100)}% match
                  </span>
                )}
              </div>
              {sources[selectedSource].snippet && (
                <p className="mt-1 text-xs text-text-dim line-clamp-3">
                  "{sources[selectedSource].snippet}"
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Expanded view with all details */}
      {isExpanded && (
        <div className="mt-3 space-y-2 animate-[slide-up_0.2s_ease-out]">
          {sources.map((source, index) => (
            <div
              key={index}
              className="p-2 rounded-lg bg-void-surface/50 border border-void-lighter hover:border-glow/20 transition-colors"
            >
              <div className="flex items-start gap-2">
                <div className="flex-shrink-0 w-5 h-5 rounded bg-nebula/20 text-nebula text-xs font-medium flex items-center justify-center">
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-text truncate">
                      {source.filename}
                    </span>
                    {source.page && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-void-lighter text-text-muted">
                        Page {source.page}
                      </span>
                    )}
                    {source.score && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-glow/10 text-glow">
                        {Math.round(source.score * 100)}% match
                      </span>
                    )}
                  </div>
                  {source.snippet && (
                    <p className="mt-1 text-xs text-text-dim">
                      "{source.snippet}"
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default MessageBubble;
