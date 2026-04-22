/**
 * SQL Chat Page Component
 *
 * Main page for Chat with Data feature with:
 * - Connection sidebar (list + add new)
 * - Schema explorer panel
 * - Main chat area
 * - Responsive layout
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Database,
  Plus,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
  AlertCircle,
} from 'lucide-react';

import { useSQLChat } from '../../contexts/SQLChatContext';
import { useApp } from '../../contexts/AppContext';
import { withBasePath } from '../../utils/paths';
import { DatabaseConnectionForm } from './DatabaseConnectionForm';
import { ConnectionList } from './ConnectionList';
import { SchemaExplorer } from './SchemaExplorer';
import { QueryChat } from './QueryChat';
import type { ConnectionFormData } from '../../types/sqlChat';

export function SQLChatPage() {
  // App context for cross-feature integration
  const { analyzeInDashboard } = useApp();

  // SQL Chat context state
  const {
    connections,
    activeConnection,
    isLoadingConnections,
    activeSession,
    isCreatingSession,
    schema,
    isLoadingSchema,
    isQuerying,
    queryState,
    messages,
    error,
    // Actions
    loadConnections,
    createConnection,
    testConnection,
    deleteConnection,
    selectConnection,
    createSession,
    refreshSchema,
    sendQuery,
    cancelQuery,
    clearMessages,
    clearError,
  } = useSQLChat();

  // Local state
  const [showAddConnection, setShowAddConnection] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [schemaCollapsed, setSchemaCollapsed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegeneratingDict, setIsRegeneratingDict] = useState(false);

  // Load connections on mount
  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  // Create session when connection selected
  useEffect(() => {
    if (activeConnection && !activeSession && !isCreatingSession) {
      createSession(activeConnection.id);
    }
  }, [activeConnection, activeSession, isCreatingSession, createSession]);

  // Handle connection submission
  const handleCreateConnection = useCallback(async (data: ConnectionFormData) => {
    setIsSubmitting(true);
    try {
      const connectionId = await createConnection(data);
      if (connectionId) {
        setShowAddConnection(false);
        await selectConnection(connectionId);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [createConnection, selectConnection]);

  // Handle connection test
  const handleTestConnection = useCallback(async (data: ConnectionFormData) => {
    return testConnection(data);
  }, [testConnection]);

  // Handle connection deletion
  const handleDeleteConnection = useCallback(async (connectionId: string) => {
    if (confirm('Are you sure you want to delete this connection?')) {
      await deleteConnection(connectionId);
    }
  }, [deleteConnection]);

  // Handle query send
  const handleSendQuery = useCallback((query: string) => {
    sendQuery(query);
  }, [sendQuery]);

  // Handle dictionary regeneration
  const handleRegenerateDictionary = useCallback(async () => {
    if (!activeConnection) return;

    setIsRegeneratingDict(true);
    try {
      const response = await fetch(withBasePath(`/api/sql-chat/connections/${activeConnection.id}/dictionary/regenerate`), {
        method: 'POST',
      });
      const data = await response.json();
      if (!data.success) {
        console.error('Failed to regenerate dictionary:', data.error);
      }
    } catch (err) {
      console.error('Dictionary regeneration error:', err);
    } finally {
      setIsRegeneratingDict(false);
    }
  }, [activeConnection]);

  return (
    <div className="h-full flex bg-slate-900">
      {/* Error toast */}
      {error && (
        <div className="fixed top-4 right-4 z-50 max-w-md">
          <div className="flex items-start gap-3 px-4 py-3 bg-red-900/90 border border-red-700 rounded-lg shadow-lg">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-red-200">{error}</p>
            </div>
            <button
              onClick={clearError}
              className="text-red-400 hover:text-red-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Sidebar - Connections */}
      <div
        className={`flex-shrink-0 border-r border-slate-700 bg-slate-800/50 transition-all duration-300 ${
          sidebarCollapsed ? 'w-12' : 'w-80'
        }`}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          {!sidebarCollapsed && (
            <>
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-cyan-400" />
                <h2 className="font-medium text-white">Connections</h2>
              </div>
              <button
                onClick={() => setShowAddConnection(true)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
                title="Add connection"
              >
                <Plus className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className={`p-1.5 text-slate-400 hover:text-white transition-colors ${
              sidebarCollapsed ? 'mx-auto' : ''
            }`}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Connection list */}
        {!sidebarCollapsed && (
          <div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 120px)' }}>
            <ConnectionList
              connections={connections}
              activeConnectionId={activeConnection?.id || null}
              onSelect={selectConnection}
              onDelete={handleDeleteConnection}
              isLoading={isLoadingConnections}
            />
          </div>
        )}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <div>
            <h1 className="text-xl font-semibold text-white">Chat with Data</h1>
            {activeConnection && (
              <p className="text-sm text-slate-400 mt-0.5">
                Connected to {activeConnection.name}
                {isCreatingSession && ' (creating session...)'}
              </p>
            )}
          </div>
          {activeConnection && (
            <div className="text-sm text-slate-500">
              {activeSession ? `Session: ${activeSession.id.slice(0, 8)}...` : ''}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Chat area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {!activeConnection ? (
              /* No connection selected */
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <Database className="w-16 h-16 mx-auto mb-4 text-slate-600" />
                  <h2 className="text-xl font-medium text-white mb-2">
                    Select a Database Connection
                  </h2>
                  <p className="text-slate-400 mb-4 max-w-md">
                    Choose an existing connection from the sidebar or add a new one to start querying your data.
                  </p>
                  <button
                    onClick={() => setShowAddConnection(true)}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors flex items-center gap-2 mx-auto"
                  >
                    <Plus className="w-4 h-4" />
                    Add Connection
                  </button>
                </div>
              </div>
            ) : (
              /* Query chat */
              <QueryChat
                messages={messages}
                queryState={queryState}
                isQuerying={isQuerying}
                onSendQuery={handleSendQuery}
                onCancelQuery={cancelQuery}
                onClearMessages={clearMessages}
                onAnalyzeInDashboard={analyzeInDashboard}
                disabled={!activeSession}
              />
            )}
          </div>

          {/* Schema panel */}
          {activeConnection && (
            <div
              className={`flex-shrink-0 border-l border-slate-700 bg-slate-800/30 transition-all duration-300 ${
                schemaCollapsed ? 'w-12' : 'w-80'
              }`}
            >
              {/* Schema header */}
              <div className="flex items-center justify-between p-4 border-b border-slate-700">
                <button
                  onClick={() => setSchemaCollapsed(!schemaCollapsed)}
                  className={`p-1.5 text-slate-400 hover:text-white transition-colors ${
                    schemaCollapsed ? 'mx-auto' : ''
                  }`}
                >
                  {schemaCollapsed ? (
                    <ChevronLeft className="w-4 h-4" />
                  ) : (
                    <ChevronRight className="w-4 h-4" />
                  )}
                </button>
                {!schemaCollapsed && (
                  <h3 className="font-medium text-white">Schema</h3>
                )}
              </div>

              {/* Schema explorer */}
              {!schemaCollapsed && (
                <div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 180px)' }}>
                  <SchemaExplorer
                    schema={schema}
                    isLoading={isLoadingSchema}
                    onRefresh={() => activeConnection && refreshSchema(activeConnection.id)}
                    onRegenerateDictionary={handleRegenerateDictionary}
                    isRegenerating={isRegeneratingDict}
                    dictionaryReady={!!activeSession}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Add Connection Modal */}
      {showAddConnection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 flex-shrink-0">
              <h2 className="text-lg font-semibold text-white">Add Database Connection</h2>
              <button
                onClick={() => setShowAddConnection(false)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              <DatabaseConnectionForm
                onSubmit={handleCreateConnection}
                onTest={handleTestConnection}
                onCancel={() => setShowAddConnection(false)}
                isLoading={isSubmitting}
              />
            </div>
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {isCreatingSession && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
          <div className="flex items-center gap-3 px-6 py-4 bg-slate-800 rounded-lg shadow-lg">
            <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
            <span className="text-white">Creating session...</span>
          </div>
        </div>
      )}

    </div>
  );
}
