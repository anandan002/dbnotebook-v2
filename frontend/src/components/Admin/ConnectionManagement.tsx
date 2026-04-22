import { useState, useEffect, useCallback } from 'react';
import { Database, X, Trash2 } from 'lucide-react';
import { withBasePath } from '../../utils/paths';

interface Connection {
  connection_id: string;
  name: string;
  db_type: string;
  host: string;
  port: number;
  database: string;
  username: string;
  user_id: string;
  owner_username?: string;
  created_at?: string;
}

export function ConnectionManagement() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchConnections = useCallback(async () => {
    try {
      // Use the SQL Chat connections endpoint
      const response = await fetch(withBasePath('/api/sql-chat/connections'), {
        credentials: 'include',
      });
      const data = await response.json();
      if (data.success) {
        setConnections(data.connections || []);
      } else {
        setError(data.error || 'Failed to fetch connections');
      }
    } catch (err) {
      setError('Failed to fetch connections');
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      await fetchConnections();
      setIsLoading(false);
    };
    loadData();
  }, [fetchConnections]);

  const handleDeleteConnection = async (connectionId: string, connectionName: string) => {
    if (!confirm(`Are you sure you want to delete the connection "${connectionName}"? This will also delete all chat sessions associated with this connection.`)) {
      return;
    }

    try {
      const response = await fetch(withBasePath(`/api/sql-chat/connections/${connectionId}`), {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await response.json();

      if (data.success) {
        await fetchConnections();
      } else {
        setError(data.error || 'Failed to delete connection');
      }
    } catch (err) {
      setError('Failed to delete connection');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Database Connections</h2>
          <p className="text-sm text-gray-400 mt-1">
            Manage SQL Chat database connections
          </p>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-300 hover:text-white">
            <X className="w-4 h-4 inline" />
          </button>
        </div>
      )}

      {/* Connections Table */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-700">
          <thead className="bg-gray-750">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Host</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Database</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Owner</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Created</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {connections.map((conn) => (
              <tr key={conn.connection_id} className="hover:bg-gray-750">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center text-white">
                    <Database className="w-4 h-4 mr-2 text-blue-400" />
                    {conn.name}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 text-xs rounded-full ${
                    conn.db_type === 'postgresql' ? 'bg-blue-900 text-blue-300' :
                    conn.db_type === 'mysql' ? 'bg-orange-900 text-orange-300' :
                    'bg-gray-700 text-gray-300'
                  }`}>
                    {conn.db_type}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                  {conn.host}:{conn.port}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{conn.database}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                  {conn.owner_username || '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                  {conn.created_at ? new Date(conn.created_at).toLocaleDateString() : '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                  <button
                    onClick={() => handleDeleteConnection(conn.connection_id, conn.name)}
                    className="text-red-400 hover:text-red-300"
                    title="Delete Connection"
                  >
                    <Trash2 className="w-4 h-4 inline" />
                  </button>
                </td>
              </tr>
            ))}
            {connections.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-gray-400">
                  No database connections found. Create connections in SQL Chat.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
