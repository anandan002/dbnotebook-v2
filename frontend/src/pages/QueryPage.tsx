/**
 * Query API Page
 *
 * Simple interface to test the programmatic RAG API:
 * 1. Select a notebook from the list
 * 2. Enter a query
 * 3. View the response and sources
 */

import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Search,
  Send,
  Book,
  FileText,
  Clock,
  Loader2,
  CheckCircle,
  AlertCircle,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Timer,
  Zap,
  Database,
  Brain,
  Layers,
  Key,
  Filter
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { useAuth } from '../contexts/AuthContext';
import { withBasePath } from '../utils/paths';

interface Notebook {
  id: string;
  name: string;
  document_count: number;
  created_at: string | null;
}

interface Source {
  filename: string;
  snippet: string;
  score: number;
}

interface Timings {
  '1_notebook_lookup_ms': number;
  '2_node_cache_ms': number;
  '3_create_retriever_ms': number;
  '4_chunk_retrieval_ms': number;
  '5_format_sources_ms': number;
  '6_raptor_total_ms': number;
  '6a_raptor_embedding_ms': number;
  '6b_raptor_lookup_ms': number;
  '7_context_building_ms': number;
  '8_llm_completion_ms': number;
}

interface QueryResponse {
  success: boolean;
  response?: string;
  session_id?: string;
  sources?: Source[];
  metadata?: {
    execution_time_ms: number;
    model: string;
    retrieval_strategy: string;
    node_count: number;
    raptor_summaries_used?: number;
    history_messages_used?: number;
    response_format?: string;
    reranker_enabled?: boolean;
    reranker_model?: string;
    top_k?: number;
    timings?: Timings;
  };
  error?: string;
}

// Reranker model fetched from API
interface RerankerModel {
  id: string;
  name: string;
  type: 'local' | 'groq' | 'disabled';
  description: string;
}

// Fallback models if API fails
const FALLBACK_RERANKER_MODELS: RerankerModel[] = [
  { id: 'default', name: 'Default', type: 'local', description: 'Use server default' },
  { id: 'xsmall', name: 'XSmall', type: 'local', description: 'Fastest' },
  { id: 'base', name: 'Base', type: 'local', description: 'Balanced' },
  { id: 'large', name: 'Large', type: 'local', description: 'Best local' },
  { id: 'disabled', name: 'Disabled', type: 'disabled', description: 'No reranking' },
];

export function QueryPage() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [selectedNotebook, setSelectedNotebook] = useState<Notebook | null>(null);
  const [query, setQuery] = useState('');
  const [isLoadingNotebooks, setIsLoadingNotebooks] = useState(true);
  const [isQuerying, setIsQuerying] = useState(false);
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showTimings, setShowTimings] = useState(false);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  // Memory toggle: when enabled, session_id is sent for ephemeral in-memory history
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  // Session tracking for conversation memory (only used when memoryEnabled)
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Response format: default|analytical|detailed|brief
  const [responseFormat, setResponseFormat] = useState<'default' | 'analytical' | 'detailed' | 'brief'>('default');
  // Reranker model selection
  const [rerankerModel, setRerankerModel] = useState<string>('default');
  // Available reranker models from API
  const [rerankerModels, setRerankerModels] = useState<RerankerModel[]>(FALLBACK_RERANKER_MODELS);

  // Use global model selection from app context (header selector)
  const { selectedModel, selectedProvider } = useApp();

  // Get user and API key from auth context
  const { user, isLoading: isLoadingAuth } = useAuth();
  const apiKey = user?.api_key ?? null;

  // Clear session when notebook changes (new context = new conversation)
  useEffect(() => {
    setSessionId(null);
    setResponse(null);
  }, [selectedNotebook?.id]);

  // Load notebooks when API key becomes available
  useEffect(() => {
    loadNotebooks();
  }, [apiKey]);

  // Load reranker models from API
  useEffect(() => {
    fetch(withBasePath('/api/settings/reranker'))
      .then(res => res.json())
      .then(data => {
        if (data.success && data.available_models) {
          // Add default and disabled options to the fetched models
          const models: RerankerModel[] = [
            { id: 'default', name: 'Default', type: 'local', description: 'Use server default' },
            ...data.available_models.filter((m: RerankerModel) => m.type !== 'disabled'),
            { id: 'disabled', name: 'Disabled', type: 'disabled', description: 'No reranking' },
          ];
          setRerankerModels(models);
        }
      })
      .catch(err => {
        console.warn('Failed to fetch reranker models:', err);
      });
  }, []);

  const loadNotebooks = async () => {
    if (!apiKey) {
      // Wait for API key to load first
      return;
    }

    setIsLoadingNotebooks(true);
    setError(null);
    try {
      const res = await fetch(withBasePath('/api/query/notebooks'), {
        headers: {
          'X-API-Key': apiKey,
        },
      });
      const data = await res.json();
      if (data.success) {
        setNotebooks(data.notebooks || []);
      } else {
        setError(data.error || 'Failed to load notebooks');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notebooks');
    } finally {
      setIsLoadingNotebooks(false);
    }
  };

  const handleQuery = useCallback(async () => {
    if (!selectedNotebook || !query.trim() || !apiKey) return;

    setIsQuerying(true);
    setError(null);
    setResponse(null);

    try {
      // Only generate/send session_id when memory is enabled
      let currentSessionId: string | undefined = undefined;
      if (memoryEnabled) {
        currentSessionId = sessionId || crypto.randomUUID();
        if (!sessionId) {
          setSessionId(currentSessionId);
        }
      }

      const requestBody: Record<string, unknown> = {
        notebook_id: selectedNotebook.id,
        query: query.trim(),
        include_sources: true,
        max_sources: 6,
        max_history: memoryEnabled ? 10 : 0,
        // Only include session_id if memory is enabled
        ...(memoryEnabled && currentSessionId ? { session_id: currentSessionId } : {}),
        // Include selected model and provider
        model: selectedModel || undefined,
        provider: selectedProvider || undefined,
        // Response format: default|analytical|detailed|brief
        response_format: responseFormat,
        // Reranker settings (only if not default)
        ...(rerankerModel !== 'default' ? {
          reranker_enabled: rerankerModel !== 'disabled',
          reranker_model: rerankerModel !== 'disabled' ? rerankerModel : undefined,
        } : {}),
      };

      const res = await fetch(withBasePath('/api/query'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify(requestBody),
      });

      const data: QueryResponse = await res.json();
      setResponse(data);

      // Update session_id if backend returns one and memory is enabled
      if (memoryEnabled && data.success && data.session_id && data.session_id !== currentSessionId) {
        setSessionId(data.session_id);
      }

      if (!data.success) {
        setError(data.error || 'Query failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setIsQuerying(false);
    }
  }, [selectedNotebook, query, apiKey, sessionId, memoryEnabled, selectedModel, selectedProvider, responseFormat, rerankerModel]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleQuery();
    }
  };

  const copyResponse = () => {
    if (response?.response) {
      navigator.clipboard.writeText(response.response);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const copyApiKey = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      setApiKeyCopied(true);
      setTimeout(() => setApiKeyCopied(false), 2000);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Unknown';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="query-page h-full flex flex-col bg-void">
      {/* Header */}
      <div className="p-6 border-b border-void-surface">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text mb-2">
              <span className="gradient-text">Query</span> API
            </h1>
            <p className="text-text-muted text-sm">
              Test the programmatic RAG API - select a notebook and ask questions
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Memory Toggle - Controls ephemeral session memory */}
            <button
              onClick={() => {
                setMemoryEnabled(!memoryEnabled);
                if (memoryEnabled) {
                  // Clear session when disabling memory
                  setSessionId(null);
                }
              }}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors
                ${memoryEnabled
                  ? 'bg-glow/10 border-glow/30 text-glow'
                  : 'bg-void-surface border-void-lighter text-text-muted hover:border-glow/30'
                }`}
              title={memoryEnabled ? 'Memory enabled - click to disable' : 'Memory disabled - click to enable session memory'}
            >
              <Brain className="w-4 h-4" />
              <span className="text-sm font-medium">Memory</span>
              {memoryEnabled && <span className="w-2 h-2 rounded-full bg-glow" />}
            </button>

            {/* Reranker Model Dropdown */}
            <div className="flex items-center gap-2 bg-void-surface rounded-lg px-3 py-2 border border-void-lighter">
              <Filter className="w-4 h-4 text-glow" />
              <select
                value={rerankerModel}
                onChange={(e) => setRerankerModel(e.target.value)}
                className="bg-transparent text-sm text-text border-none outline-none cursor-pointer"
                title="Reranker model - controls retrieval quality vs speed"
              >
                {/* Group models by type */}
                {rerankerModels.filter(m => m.type === 'local' || m.id === 'default').map((opt) => (
                  <option key={opt.id} value={opt.id} className="bg-void-surface text-text">
                    {opt.name} {opt.id !== 'default' && `(${opt.description})`}
                  </option>
                ))}
                {rerankerModels.filter(m => m.type === 'groq').length > 0 && (
                  <optgroup label="Groq Cloud (faster)">
                    {rerankerModels.filter(m => m.type === 'groq').map((opt) => (
                      <option key={opt.id} value={opt.id} className="bg-void-surface text-text">
                        {opt.name} ({opt.description})
                      </option>
                    ))}
                  </optgroup>
                )}
                {rerankerModels.filter(m => m.type === 'disabled').map((opt) => (
                  <option key={opt.id} value={opt.id} className="bg-void-surface text-text">
                    {opt.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Response Format Dropdown */}
            <div className="flex items-center gap-2 bg-void-surface rounded-lg px-3 py-2 border border-void-lighter">
              <FileText className="w-4 h-4 text-nebula-bright" />
              <select
                value={responseFormat}
                onChange={(e) => setResponseFormat(e.target.value as 'default' | 'analytical' | 'detailed' | 'brief')}
                className="bg-transparent text-sm text-text border-none outline-none cursor-pointer"
                title="Response format - controls how the API structures the response"
              >
                <option value="default" className="bg-void-surface text-text">Default</option>
                <option value="analytical" className="bg-void-surface text-text">Analytical (Tables)</option>
                <option value="detailed" className="bg-void-surface text-text">Detailed</option>
                <option value="brief" className="bg-void-surface text-text">Brief</option>
              </select>
            </div>

            {/* API Key Display */}
            <div className="flex items-center gap-2 bg-void-surface rounded-lg px-3 py-2 border border-void-lighter">
              <Key className="w-4 h-4 text-glow" />
              <span className="text-xs text-text-muted">API Key:</span>
              {isLoadingAuth ? (
                <Loader2 className="w-4 h-4 text-text-muted animate-spin" />
              ) : apiKey ? (
                <>
                  <code className="text-xs font-mono text-text bg-void px-2 py-0.5 rounded">
                    {apiKey.slice(0, 12)}...{apiKey.slice(-4)}
                  </code>
                  <button
                    onClick={copyApiKey}
                    className="p-1 rounded hover:bg-void-lighter transition-colors"
                    title="Copy API key"
                  >
                    {apiKeyCopied ? (
                      <Check className="w-3.5 h-3.5 text-green-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-text-muted" />
                    )}
                  </button>
                </>
              ) : (
                <span className="text-xs text-red-400">Not configured</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Notebook Selection */}
        <div className="w-80 border-r border-void-surface flex flex-col">
          <div className="p-4 border-b border-void-surface">
            <h2 className="text-sm font-semibold text-text flex items-center gap-2">
              <Book className="w-4 h-4 text-glow" />
              Select Notebook
            </h2>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {isLoadingNotebooks ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-glow animate-spin" />
              </div>
            ) : notebooks.length === 0 ? (
              <div className="text-center py-8 text-text-muted">
                <Book className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No notebooks found</p>
              </div>
            ) : (
              <div className="space-y-1">
                {notebooks.map((nb) => (
                  <button
                    key={nb.id}
                    onClick={() => setSelectedNotebook(nb)}
                    className={`
                      w-full text-left p-3 rounded-lg transition-all
                      ${selectedNotebook?.id === nb.id
                        ? 'bg-glow/20 border border-glow/50'
                        : 'bg-void-surface hover:bg-void-lighter border border-transparent'
                      }
                    `}
                  >
                    <div className="flex items-start justify-between">
                      <span className={`font-medium text-sm ${
                        selectedNotebook?.id === nb.id ? 'text-glow' : 'text-text'
                      }`}>
                        {nb.name}
                      </span>
                      {selectedNotebook?.id === nb.id && (
                        <CheckCircle className="w-4 h-4 text-glow shrink-0" />
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-text-muted">
                      <span className="flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        {nb.document_count} docs
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(nb.created_at)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Query and Response */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Query Input */}
          <div className="p-4 border-b border-void-surface">
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-dim" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={selectedNotebook
                    ? `Ask about ${selectedNotebook.name}...`
                    : 'Select a notebook first...'
                  }
                  disabled={!selectedNotebook || isQuerying}
                  className="
                    w-full pl-10 pr-4 py-3
                    bg-void-surface text-text
                    rounded-lg border border-void-lighter
                    placeholder:text-text-dim
                    focus:outline-none focus:border-glow focus:ring-1 focus:ring-glow/30
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-all
                  "
                />
              </div>
              <button
                onClick={handleQuery}
                disabled={!selectedNotebook || !query.trim() || isQuerying}
                className="
                  px-6 py-3 rounded-lg
                  bg-glow text-void font-medium
                  hover:bg-glow-bright
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-all flex items-center gap-2
                "
              >
                {isQuerying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Querying...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Send
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Response Area */}
          <div className="flex-1 overflow-y-auto p-4">
            {error && (
              <div className="mb-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-red-400">Error</p>
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              </div>
            )}

            {response?.success && (
              <div className="space-y-4">
                {/* Response */}
                <div className="bg-void-surface rounded-lg border border-void-lighter overflow-hidden">
                  <div className="p-3 border-b border-void-lighter flex items-center justify-between">
                    <h3 className="font-semibold text-text flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-400" />
                      Response
                    </h3>
                    <button
                      onClick={copyResponse}
                      className="p-1.5 rounded hover:bg-void-lighter transition-colors"
                      title="Copy response"
                    >
                      {copied ? (
                        <Check className="w-4 h-4 text-green-400" />
                      ) : (
                        <Copy className="w-4 h-4 text-text-muted" />
                      )}
                    </button>
                  </div>
                  <div className="p-4 prose prose-invert max-w-none">
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
                              className="px-1.5 py-0.5 rounded bg-void text-glow-bright font-mono text-sm"
                              {...props}
                            >
                              {children}
                            </code>
                          ) : (
                            <code
                              className="block p-4 rounded-lg bg-void text-text font-mono text-sm overflow-x-auto"
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
                          <h1 className="text-xl font-bold text-text mt-4 mb-2">
                            {children}
                          </h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className="text-lg font-bold text-text mt-3 mb-2">
                            {children}
                          </h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className="text-base font-bold text-text mt-2 mb-1">
                            {children}
                          </h3>
                        ),
                        table: ({ children }) => (
                          <div className="overflow-x-auto my-4">
                            <table className="min-w-full border-collapse border border-void-lighter rounded-lg overflow-hidden">
                              {children}
                            </table>
                          </div>
                        ),
                        thead: ({ children }) => (
                          <thead className="bg-void/50">{children}</thead>
                        ),
                        tbody: ({ children }) => (
                          <tbody className="divide-y divide-void-lighter">{children}</tbody>
                        ),
                        tr: ({ children }) => (
                          <tr className="hover:bg-void-light/30 transition-colors">{children}</tr>
                        ),
                        th: ({ children }) => (
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-glow uppercase tracking-wider border-b border-void-lighter">
                            {children}
                          </th>
                        ),
                        td: ({ children }) => (
                          <td className="px-4 py-3 text-sm text-text border-r border-void-lighter/50 last:border-r-0">
                            {children}
                          </td>
                        ),
                      }}
                    >
                      {response.response}
                    </ReactMarkdown>
                  </div>
                </div>

                {/* Metadata */}
                {response.metadata && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-3 text-xs">
                      <span className="px-2 py-1 bg-void-surface rounded text-text-muted">
                        <Clock className="w-3 h-3 inline mr-1" />
                        {(response.metadata.execution_time_ms / 1000).toFixed(2)}s
                      </span>
                      <span className="px-2 py-1 bg-void-surface rounded text-text-muted">
                        Model: {response.metadata.model}
                      </span>
                      <span className="px-2 py-1 bg-void-surface rounded text-text-muted">
                        Strategy: {response.metadata.retrieval_strategy}
                      </span>
                      <span className="px-2 py-1 bg-void-surface rounded text-text-muted">
                        {response.metadata.node_count} nodes
                      </span>
                      {response.metadata.response_format && response.metadata.response_format !== 'default' && (
                        <span className="px-2 py-1 bg-nebula/20 rounded text-nebula-bright">
                          <FileText className="w-3 h-3 inline mr-1" />
                          {response.metadata.response_format}
                        </span>
                      )}
                      {response.metadata.reranker_model && (
                        <span className={`px-2 py-1 rounded ${response.metadata.reranker_enabled ? 'bg-glow/20 text-glow' : 'bg-void-lighter text-text-muted'}`}>
                          <Filter className="w-3 h-3 inline mr-1" />
                          Reranker: {response.metadata.reranker_model}
                          {response.metadata.top_k && ` (top ${response.metadata.top_k})`}
                        </span>
                      )}
                      {response.metadata.raptor_summaries_used !== undefined && (
                        <span className="px-2 py-1 bg-nebula/20 rounded text-nebula-bright">
                          <Layers className="w-3 h-3 inline mr-1" />
                          {response.metadata.raptor_summaries_used} RAPTOR summaries
                        </span>
                      )}
                      {response.metadata.history_messages_used !== undefined && response.metadata.history_messages_used > 0 && (
                        <span className="px-2 py-1 bg-glow/20 rounded text-glow">
                          <Brain className="w-3 h-3 inline mr-1" />
                          {response.metadata.history_messages_used} history messages
                        </span>
                      )}
                      {response.session_id && (
                        <span className="px-2 py-1 bg-void-surface rounded text-text-dim font-mono text-xs">
                          Session: {response.session_id.slice(0, 8)}...
                        </span>
                      )}
                    </div>

                    {/* Timing Breakdown */}
                    {response.metadata.timings && (
                      <div className="bg-void-surface rounded-lg border border-void-lighter overflow-hidden">
                        <button
                          onClick={() => setShowTimings(!showTimings)}
                          className="w-full p-3 flex items-center justify-between hover:bg-void-lighter transition-colors"
                        >
                          <span className="font-semibold text-text flex items-center gap-2 text-sm">
                            <Timer className="w-4 h-4 text-glow" />
                            Performance Timings
                          </span>
                          {showTimings ? (
                            <ChevronDown className="w-4 h-4 text-text-muted" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-text-muted" />
                          )}
                        </button>

                        {showTimings && (
                          <div className="p-4 border-t border-void-lighter">
                            <div className="space-y-2">
                              {/* Timing bars */}
                              {(() => {
                                const timings = response.metadata!.timings!;
                                const total = response.metadata!.execution_time_ms;
                                const stages = [
                                  { key: '1_notebook_lookup_ms', label: 'Notebook Lookup', icon: Database, color: 'bg-blue-500' },
                                  { key: '2_node_cache_ms', label: 'Node Cache', icon: Database, color: 'bg-blue-400' },
                                  { key: '3_create_retriever_ms', label: 'Create Retriever', icon: Zap, color: 'bg-yellow-500' },
                                  { key: '4_chunk_retrieval_ms', label: 'Chunk Retrieval', icon: Search, color: 'bg-green-500' },
                                  { key: '5_format_sources_ms', label: 'Format Sources', icon: FileText, color: 'bg-green-400' },
                                  { key: '6_raptor_total_ms', label: 'RAPTOR Total', icon: Layers, color: 'bg-purple-500', isParent: true },
                                  { key: '6a_raptor_embedding_ms', label: '-> Embedding', icon: null, color: 'bg-purple-400', isChild: true },
                                  { key: '6b_raptor_lookup_ms', label: '-> ANN Lookup', icon: null, color: 'bg-purple-300', isChild: true },
                                  { key: '7_context_building_ms', label: 'Context Building', icon: FileText, color: 'bg-orange-500' },
                                  { key: '8_llm_completion_ms', label: 'LLM Completion', icon: Brain, color: 'bg-red-500' },
                                ];

                                return stages.map(({ key, label, icon: Icon, color, isChild }) => {
                                  const ms = timings[key as keyof Timings] || 0;
                                  const pct = total > 0 ? (ms / total) * 100 : 0;

                                  return (
                                    <div key={key} className={`${isChild ? 'ml-4' : ''}`}>
                                      <div className="flex items-center justify-between text-xs mb-1">
                                        <span className={`flex items-center gap-1.5 ${isChild ? 'text-text-dim' : 'text-text-muted'}`}>
                                          {Icon && <Icon className="w-3 h-3" />}
                                          {label}
                                        </span>
                                        <span className="text-text font-mono">
                                          {ms.toLocaleString()}ms
                                          <span className="text-text-dim ml-1">
                                            ({pct.toFixed(1)}%)
                                          </span>
                                        </span>
                                      </div>
                                      <div className="h-2 bg-void rounded-full overflow-hidden">
                                        <div
                                          className={`h-full ${color} transition-all duration-500`}
                                          style={{ width: `${Math.max(pct, 0.5)}%` }}
                                        />
                                      </div>
                                    </div>
                                  );
                                });
                              })()}
                            </div>

                            {/* Summary */}
                            <div className="mt-4 pt-3 border-t border-void-lighter">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-text-muted">Bottleneck:</span>
                                <span className="text-red-400 font-medium">
                                  LLM Completion ({((response.metadata!.timings!['8_llm_completion_ms'] / response.metadata!.execution_time_ms) * 100).toFixed(1)}%)
                                </span>
                              </div>
                              {response.metadata.timings['6b_raptor_lookup_ms'] !== undefined && (
                                <div className="flex items-center justify-between text-xs mt-1">
                                  <span className="text-text-muted">RAPTOR ANN Speed:</span>
                                  <span className="text-green-400 font-medium">
                                    {response.metadata.timings['6b_raptor_lookup_ms']}ms (O(log n))
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Sources */}
                {response.sources && response.sources.length > 0 && (
                  <div className="bg-void-surface rounded-lg border border-void-lighter overflow-hidden">
                    <div className="p-3 border-b border-void-lighter">
                      <h3 className="font-semibold text-text flex items-center gap-2">
                        <FileText className="w-4 h-4 text-nebula-bright" />
                        Sources ({response.sources.length})
                      </h3>
                    </div>
                    <div className="divide-y divide-void-lighter">
                      {response.sources.map((source, idx) => (
                        <div key={idx} className="p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-text">
                              {source.filename}
                            </span>
                            <span className="text-xs px-2 py-0.5 bg-nebula/20 text-nebula-bright rounded">
                              {(source.score * 100).toFixed(1)}% match
                            </span>
                          </div>
                          <p className="text-sm text-text-muted line-clamp-2">
                            {source.snippet}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Empty State */}
            {!response && !error && !isQuerying && (
              <div className="h-full flex items-center justify-center">
                <div className="text-center max-w-md">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-glow/10 flex items-center justify-center">
                    <Search className="w-8 h-8 text-glow" />
                  </div>
                  <h3 className="text-lg font-semibold text-text mb-2">
                    Ready to Query
                  </h3>
                  <p className="text-text-muted text-sm">
                    {selectedNotebook
                      ? `Selected: ${selectedNotebook.name}. Enter your question above.`
                      : 'Select a notebook from the left panel, then enter your question.'
                    }
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default QueryPage;
