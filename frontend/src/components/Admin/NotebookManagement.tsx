import { useState, useEffect, useCallback } from 'react';
import { Plus, Globe, User, FileText, X, Trash2 } from 'lucide-react';
import type { NotebookAdmin } from '../../types/auth';
import { withBasePath } from '../../utils/paths';

export function NotebookManagement() {
  const [notebooks, setNotebooks] = useState<NotebookAdmin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState('');

  const fetchNotebooks = useCallback(async () => {
    try {
      const response = await fetch(withBasePath('/api/admin/notebooks'), {
        credentials: 'include',
      });
      const data = await response.json();
      if (data.success) {
        setNotebooks(data.notebooks);
      } else {
        setError(data.error || 'Failed to fetch notebooks');
      }
    } catch (err) {
      setError('Failed to fetch notebooks');
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      await fetchNotebooks();
      setIsLoading(false);
    };
    loadData();
  }, [fetchNotebooks]);

  const handleCreateNotebook = async () => {
    if (!newNotebookName.trim()) return;

    try {
      const response = await fetch(withBasePath('/api/admin/notebooks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newNotebookName }),
      });
      const data = await response.json();

      if (data.success) {
        await fetchNotebooks();
        setShowCreateModal(false);
        setNewNotebookName('');
      } else {
        setError(data.error || 'Failed to create notebook');
      }
    } catch (err) {
      setError('Failed to create notebook');
    }
  };

  const handleDeleteNotebook = async (notebookId: string, notebookName: string) => {
    if (!confirm(`Are you sure you want to delete "${notebookName}"? This will also delete all documents in this notebook.`)) {
      return;
    }

    try {
      const response = await fetch(withBasePath(`/api/notebooks/${notebookId}`), {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await response.json();

      if (data.success) {
        await fetchNotebooks();
      } else {
        setError(data.error || 'Failed to delete notebook');
      }
    } catch (err) {
      setError('Failed to delete notebook');
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
          <h2 className="text-lg font-semibold text-white">Notebooks</h2>
          <p className="text-sm text-gray-400 mt-1">
            Notebooks created by admin are automatically global (visible to all users)
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Global Notebook
        </button>
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

      {/* Notebooks Table */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-700">
          <thead className="bg-gray-750">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Owner</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Documents</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Created</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {notebooks.map((notebook) => (
              <tr key={notebook.notebook_id} className="hover:bg-gray-750">
                <td className="px-6 py-4 whitespace-nowrap text-sm text-white">{notebook.name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{notebook.username}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {notebook.is_global ? (
                    <span className="flex items-center text-green-400">
                      <Globe className="w-4 h-4 mr-1" />
                      Global
                    </span>
                  ) : (
                    <span className="flex items-center text-gray-400">
                      <User className="w-4 h-4 mr-1" />
                      User
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <span className="flex items-center text-gray-300">
                    <FileText className="w-4 h-4 mr-1" />
                    {notebook.document_count}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                  {notebook.created_at ? new Date(notebook.created_at).toLocaleDateString() : '-'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                  <button
                    onClick={() => handleDeleteNotebook(notebook.notebook_id, notebook.name)}
                    className="text-red-400 hover:text-red-300"
                    title="Delete Notebook"
                  >
                    <Trash2 className="w-4 h-4 inline" />
                  </button>
                </td>
              </tr>
            ))}
            {notebooks.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-400">
                  No notebooks found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create Notebook Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-white mb-4">Create Global Notebook</h3>
            <p className="text-sm text-gray-400 mb-4">
              This notebook will be visible to all users in the system.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Notebook Name</label>
              <input
                type="text"
                value={newNotebookName}
                onChange={(e) => setNewNotebookName(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter notebook name"
              />
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => { setShowCreateModal(false); setNewNotebookName(''); }}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateNotebook}
                disabled={!newNotebookName.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
