/**
 * SQL Chat Context for Chat with Data (Text-to-SQL) feature.
 *
 * Manages:
 * - Database connections (create, test, delete)
 * - Chat sessions per connection
 * - Schema introspection
 * - Query execution with streaming
 * - Query history and refinement
 * - Error handling
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';

import type {
  DatabaseConnection,
  ConnectionFormData,
  SQLChatSession,
  SchemaInfo,
  QueryResult,
  QueryState,
  QueryHistoryEntry,
  SQLChatMessage,
  SQLChatContextValue,
  SQLQuerySettings,
} from '../types/sqlChat';
import { withBasePath } from '../utils/paths';

// API base URL
const API_BASE = withBasePath('/api/sql-chat');

// Generate unique message ID
const generateId = () => `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const SQLChatContext = createContext<SQLChatContextValue | undefined>(undefined);

export function SQLChatProvider({ children }: { children: ReactNode }) {
  // Connection state
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
  const [activeConnection, setActiveConnection] = useState<DatabaseConnection | null>(null);
  const [isLoadingConnections, setIsLoadingConnections] = useState(false);

  // Session state
  const [activeSession, setActiveSession] = useState<SQLChatSession | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  // Cache sessions per connection to avoid recreating
  const [sessionCache, setSessionCache] = useState<Record<string, SQLChatSession>>({});

  // Schema state
  const [schema, setSchema] = useState<SchemaInfo | null>(null);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);

  // Query state
  const [isQuerying, setIsQuerying] = useState(false);
  const [queryState, setQueryState] = useState<QueryState>('idle');
  const [currentQuery, setCurrentQuery] = useState('');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);

  // Chat messages
  const [messages, setMessages] = useState<SQLChatMessage[]>([]);

  // History
  const [queryHistory, setQueryHistory] = useState<QueryHistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Error
  const [error, setError] = useState<string | null>(null);

  // Abort controller for cancelling queries
  const abortControllerRef = useRef<AbortController | null>(null);

  // ========================================
  // Connection Management
  // ========================================

  const loadConnections = useCallback(async () => {
    setIsLoadingConnections(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/connections`);
      const data = await response.json();

      if (data.success) {
        setConnections(data.connections || []);
      } else {
        setError(data.error || 'Failed to load connections');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connections');
    } finally {
      setIsLoadingConnections(false);
    }
  }, []);

  const createConnection = useCallback(async (formData: ConnectionFormData): Promise<string | null> => {
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          db_type: formData.dbType,
          host: formData.host,
          port: formData.port,
          database: formData.databaseName,
          username: formData.username,
          password: formData.password,
          connection_string: formData.connectionString,
          use_connection_string: formData.useConnectionString,
          masking_policy: formData.maskingPolicy ? {
            mask_columns: formData.maskingPolicy.maskColumns,
            redact_columns: formData.maskingPolicy.redactColumns,
            hash_columns: formData.maskingPolicy.hashColumns,
          } : undefined,
        }),
      });

      const data = await response.json();

      if (data.success && data.connectionId) {
        // Reload connections to get the new one
        await loadConnections();
        return data.connectionId;
      } else {
        setError(data.error || 'Failed to create connection');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create connection');
      return null;
    }
  }, [loadConnections]);

  const testConnection = useCallback(async (formData: ConnectionFormData): Promise<boolean> => {
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/connections/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          db_type: formData.dbType,
          host: formData.host,
          port: formData.port,
          database: formData.databaseName,
          username: formData.username,
          password: formData.password,
          connection_string: formData.connectionString,
          use_connection_string: formData.useConnectionString,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.error || data.message || 'Connection test failed');
      }

      return data.success;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection test failed');
      return false;
    }
  }, []);

  const deleteConnection = useCallback(async (connectionId: string): Promise<boolean> => {
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/connections/${connectionId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (data.success) {
        // Remove from local state
        setConnections(prev => prev.filter(c => c.id !== connectionId));

        // Clear active connection if it was deleted
        if (activeConnection?.id === connectionId) {
          setActiveConnection(null);
          setActiveSession(null);
          setSchema(null);
          setMessages([]);
        }

        return true;
      } else {
        setError(data.error || 'Failed to delete connection');
        return false;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete connection');
      return false;
    }
  }, [activeConnection]);

  const selectConnection = useCallback(async (connectionId: string) => {
    const connection = connections.find(c => c.id === connectionId);
    if (connection) {
      setActiveConnection(connection);

      // Check if we have a cached session for this connection
      const cachedSession = sessionCache[connectionId];
      if (cachedSession) {
        setActiveSession(cachedSession);
        // Load history for cached session
        await loadHistory(cachedSession.id);
      } else {
        setActiveSession(null);
        setMessages([]);
        setQueryResult(null);
        setQueryHistory([]);
      }

      setSchema(null);

      // Load schema for the connection
      await loadSchema(connectionId);
    }
  }, [connections, sessionCache]);

  // ========================================
  // Session Management
  // ========================================

  const createSession = useCallback(async (connectionId: string): Promise<string | null> => {
    // Check cache first - reuse existing session for this connection
    if (sessionCache[connectionId]) {
      const cachedSession = sessionCache[connectionId];
      setActiveSession(cachedSession);
      // Reload history for cached session
      await loadHistory(cachedSession.id);
      return cachedSession.id;
    }

    setIsCreatingSession(true);
    setError(null);

    try {
      // Performance optimization: skip schema refresh since selectConnection already loaded it
      const response = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, skipSchemaRefresh: true }),
      });

      const data = await response.json();

      if (data.success && data.sessionId) {
        // Load the session details and cache it
        await loadSession(data.sessionId);
        return data.sessionId;
      } else {
        setError(data.error || 'Failed to create session');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
      return null;
    } finally {
      setIsCreatingSession(false);
    }
  }, [sessionCache]);

  const loadSession = useCallback(async (sessionId: string) => {
    try {
      const response = await fetch(`${API_BASE}/sessions/${sessionId}`);
      const data = await response.json();

      if (data.success && data.session) {
        // Map backend response to frontend type
        const session: SQLChatSession = {
          id: data.session.sessionId,
          userId: '', // Not returned by backend
          connectionId: data.session.connectionId,
          createdAt: data.session.createdAt,
          lastQueryAt: data.session.lastQueryAt,
        };
        setActiveSession(session);

        // Cache session by connection ID for reuse
        setSessionCache(prev => ({
          ...prev,
          [session.connectionId]: session,
        }));

        // Load history for this session
        await loadHistory(sessionId);
      } else {
        setError(data.error || 'Failed to load session');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session');
    }
  }, []);

  // ========================================
  // Schema Management
  // ========================================

  const loadSchema = useCallback(async (connectionId: string) => {
    setIsLoadingSchema(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/schema/${connectionId}`);
      const data = await response.json();

      if (data.success && data.schema) {
        setSchema(data.schema);
      } else {
        setError(data.error || 'Failed to load schema');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schema');
    } finally {
      setIsLoadingSchema(false);
    }
  }, []);

  const refreshSchema = useCallback(async (connectionId: string) => {
    setIsLoadingSchema(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/schema/${connectionId}?refresh=true`);
      const data = await response.json();

      if (data.success && data.schema) {
        setSchema(data.schema);
      } else {
        setError(data.error || 'Failed to refresh schema');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh schema');
    } finally {
      setIsLoadingSchema(false);
    }
  }, []);

  // ========================================
  // Query Execution
  // ========================================

  const sendQuery = useCallback(async (query: string, settings?: SQLQuerySettings): Promise<QueryResult | null> => {
    if (!activeSession) {
      setError('No active session. Please select a connection first.');
      return null;
    }

    setIsQuerying(true);
    setQueryState('generating');
    setCurrentQuery(query);
    setError(null);

    // Add user message
    const userMessage: SQLChatMessage = {
      id: generateId(),
      role: 'user',
      content: query,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMessage]);

    // Create abort controller
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(`${API_BASE}/query/${activeSession.id}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          // SQL query settings for few-shot retrieval
          use_reranker: settings?.rerankerEnabled,
          reranker_model: settings?.rerankerModel,
          top_k: settings?.topK,
          use_hybrid: settings?.hybridEnabled,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let result: QueryResult | null = null;
      let buffer = ''; // Buffer for incomplete SSE chunks

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Accumulate incoming data in buffer
        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages (terminated by double newline)
        const messages = buffer.split('\n\n');
        buffer = messages.pop() || ''; // Keep incomplete message in buffer

        for (const message of messages) {
          const lines = message.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6).trim();
              if (jsonStr === '[DONE]') continue;

              try {
                const data = JSON.parse(jsonStr);

                // Handle different message types from backend
                if (data.type === 'status') {
                  setQueryState(data.status as QueryState);
                } else if (data.type === 'sql') {
                  // SQL generated - update state
                  setQueryState('executing');
                } else if (data.type === 'result') {
                  // Final result - convert inline format to QueryResult
                  result = {
                    success: data.success,
                    sqlGenerated: data.sql || '',
                    data: data.data || [],
                    columns: data.columns || [],
                    rowCount: data.rowCount || 0,
                    executionTimeMs: data.executionTimeMs || 0,
                    errorMessage: data.errorMessage,
                    confidence: data.confidence,
                    explanation: data.explanation,
                    timings: data.timings,  // Per-stage timing breakdown
                  };
                  setQueryResult(result);
                } else if (data.type === 'error') {
                  setError(data.error);
                }
              } catch (e) {
                console.error('SSE parse error:', e, 'Data:', jsonStr);
              }
            }
          }
        }
      }

      // Add assistant message with result
      if (result) {
        // Use explanation if available, otherwise fallback to generic message
        let content: string;
        if (result.success) {
          content = result.explanation || `Found ${result.rowCount} result${result.rowCount !== 1 ? 's' : ''}.`;
        } else {
          content = result.errorMessage || 'Query failed';
        }

        const assistantMessage: SQLChatMessage = {
          id: generateId(),
          role: 'assistant',
          content,
          sql: result.sqlGenerated,
          result,
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, assistantMessage]);
      }

      setQueryState('complete');
      return result;

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Query cancelled');
      } else {
        setError(err instanceof Error ? err.message : 'Query failed');
      }
      setQueryState('error');
      return null;
    } finally {
      setIsQuerying(false);
      abortControllerRef.current = null;
    }
  }, [activeSession]);

  const refineQuery = useCallback(async (refinement: string, settings?: SQLQuerySettings): Promise<QueryResult | null> => {
    if (!activeSession) {
      setError('No active session');
      return null;
    }

    // Refinement is just another query with context
    return sendQuery(refinement, settings);
  }, [activeSession, sendQuery]);

  const cancelQuery = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsQuerying(false);
    setQueryState('idle');
  }, []);

  // ========================================
  // History Management
  // ========================================

  const loadHistory = useCallback(async (sessionId: string) => {
    setIsLoadingHistory(true);

    try {
      const response = await fetch(`${API_BASE}/history/${sessionId}`);
      const data = await response.json();

      if (data.success && data.history) {
        setQueryHistory(data.history);
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  // ========================================
  // Chat Management
  // ========================================

  const clearMessages = useCallback(() => {
    setMessages([]);
    setQueryResult(null);
  }, []);

  // ========================================
  // Error Handling
  // ========================================

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // ========================================
  // Context Value
  // ========================================

  const value: SQLChatContextValue = {
    // State
    connections,
    activeConnection,
    isLoadingConnections,
    activeSession,
    isCreatingSession,
    schema,
    isLoadingSchema,
    isQuerying,
    queryState,
    currentQuery,
    queryResult,
    messages,
    queryHistory,
    isLoadingHistory,
    error,

    // Actions
    loadConnections,
    createConnection,
    testConnection,
    deleteConnection,
    selectConnection,
    createSession,
    loadSession,
    loadSchema,
    refreshSchema,
    sendQuery,
    refineQuery,
    cancelQuery,
    loadHistory,
    clearMessages,
    clearError,
  };

  return (
    <SQLChatContext.Provider value={value}>
      {children}
    </SQLChatContext.Provider>
  );
}

export function useSQLChat() {
  const context = useContext(SQLChatContext);
  if (context === undefined) {
    throw new Error('useSQLChat must be used within a SQLChatProvider');
  }
  return context;
}

export { SQLChatContext };
