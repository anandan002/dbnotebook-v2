import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { Notebook } from '../types';
import { withBasePath } from '../utils/paths';

type BackendNotebook = Notebook & {
  document_count?: number;
};

interface NotebookContextType {
  // State
  notebooks: Notebook[];
  selectedNotebook: Notebook | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setNotebooks: (notebooks: Notebook[]) => void;
  selectNotebook: (notebook: Notebook | null) => void;
  createNotebook: (notebook: Notebook) => void;
  updateNotebook: (id: string, updates: Partial<Notebook>) => void;
  deleteNotebook: (id: string) => void;
  refreshNotebooks: () => Promise<void>;
  clearError: () => void;
}

const NotebookContext = createContext<NotebookContextType | undefined>(undefined);

export function NotebookProvider({ children }: { children: ReactNode }) {
  const [notebooks, setNotebooksState] = useState<Notebook[]>([]);
  const [selectedNotebook, setSelectedNotebook] = useState<Notebook | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch notebooks from API
  const refreshNotebooks = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(withBasePath('/api/notebooks'));

      if (!response.ok) {
        throw new Error(`Failed to fetch notebooks: ${response.statusText}`);
      }

      const data = await response.json();
      const normalizedNotebooks = ((data.notebooks || []) as BackendNotebook[]).map((notebook) => ({
        ...notebook,
        documentCount: notebook.documentCount ?? notebook.document_count ?? 0,
      }));
      setNotebooksState(normalizedNotebooks);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load notebooks';
      setError(errorMessage);
      console.error('Error fetching notebooks:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load notebooks on mount
  useEffect(() => {
    refreshNotebooks();
  }, [refreshNotebooks]);

  // Set notebooks from external source
  const setNotebooks = useCallback((newNotebooks: Notebook[]) => {
    setNotebooksState(newNotebooks);
    setError(null);
  }, []);

  // Select a notebook (updates state only, doesn't fetch)
  const selectNotebook = useCallback((notebook: Notebook | null) => {
    setSelectedNotebook(notebook);
    setError(null);
  }, []);

  // Create a new notebook (optimistic update)
  const createNotebook = useCallback((notebook: Notebook) => {
    setNotebooksState((prev) => [...prev, notebook]);
    setSelectedNotebook(notebook);
    setError(null);
  }, []);

  // Update an existing notebook
  const updateNotebook = useCallback((id: string, updates: Partial<Notebook>) => {
    setNotebooksState((prev) =>
      prev.map((nb) =>
        nb.id === id
          ? { ...nb, ...updates, updatedAt: new Date() }
          : nb
      )
    );

    // Update selected notebook if it's the one being updated
    setSelectedNotebook((prev) =>
      prev?.id === id
        ? { ...prev, ...updates, updatedAt: new Date() }
        : prev
    );

    setError(null);
  }, []);

  // Delete a notebook
  const deleteNotebook = useCallback((id: string) => {
    setNotebooksState((prev) => prev.filter((nb) => nb.id !== id));

    // Clear selected notebook if it's the one being deleted
    setSelectedNotebook((prev) => (prev?.id === id ? null : prev));

    setError(null);
  }, []);

  // Clear error state
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const value: NotebookContextType = {
    notebooks,
    selectedNotebook,
    isLoading,
    error,
    setNotebooks,
    selectNotebook,
    createNotebook,
    updateNotebook,
    deleteNotebook,
    refreshNotebooks,
    clearError,
  };

  return (
    <NotebookContext.Provider value={value}>
      {children}
    </NotebookContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useNotebook() {
  const context = useContext(NotebookContext);

  if (!context) {
    throw new Error('useNotebook must be used within NotebookProvider');
  }

  return context;
}
