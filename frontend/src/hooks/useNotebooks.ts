import { useState, useEffect, useCallback } from 'react';
import type { Notebook, Document, NotebookState } from '../types';
import * as api from '../services/api';

const initialState: NotebookState = {
  notebooks: [],
  selectedNotebook: null,
  isLoading: false,
  error: null,
};

export function useNotebooks() {
  const [state, setState] = useState<NotebookState>(initialState);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);

  const updateNotebookDocumentCount = useCallback((notebookId: string, count: number) => {
    setState((prev) => ({
      ...prev,
      notebooks: prev.notebooks.map((notebook) =>
        notebook.id === notebookId
          ? { ...notebook, documentCount: count }
          : notebook
      ),
      selectedNotebook:
        prev.selectedNotebook?.id === notebookId
          ? { ...prev.selectedNotebook, documentCount: count }
          : prev.selectedNotebook,
    }));
  }, []);

  // Fetch all notebooks
  const fetchNotebooks = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await api.getNotebooks();
      setState((prev) => ({
        ...prev,
        notebooks: response.notebooks,
        isLoading: false,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load notebooks',
      }));
    }
  }, []);

  // Select a notebook
  const selectNotebook = useCallback(
    async (notebook: Notebook | null) => {
      setState((prev) => ({ ...prev, selectedNotebook: notebook }));

      if (notebook) {
        setIsLoadingDocs(true);
        try {
          const response = await api.getDocuments(notebook.id);
          setDocuments(response.documents);
          updateNotebookDocumentCount(notebook.id, response.documents.length);
        } catch (error) {
          console.error('Failed to load documents:', error);
          setDocuments([]);
        } finally {
          setIsLoadingDocs(false);
        }
      } else {
        setDocuments([]);
      }
    },
    [updateNotebookDocumentCount]
  );

  // Create a new notebook
  const createNotebook = useCallback(
    async (name: string, description?: string): Promise<Notebook | null> => {
      try {
        const notebook = await api.createNotebook(name, description);
        setState((prev) => ({
          ...prev,
          notebooks: [...prev.notebooks, notebook],
        }));
        return notebook;
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Failed to create notebook',
        }));
        return null;
      }
    },
    []
  );

  // Update a notebook
  const updateNotebook = useCallback(
    async (id: string, data: Partial<Notebook>): Promise<boolean> => {
      try {
        const updated = await api.updateNotebook(id, data);
        setState((prev) => ({
          ...prev,
          notebooks: prev.notebooks.map((n) => (n.id === id ? updated : n)),
          selectedNotebook:
            prev.selectedNotebook?.id === id ? updated : prev.selectedNotebook,
        }));
        return true;
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Failed to update notebook',
        }));
        return false;
      }
    },
    []
  );

  // Delete a notebook
  const deleteNotebook = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await api.deleteNotebook(id);
        setState((prev) => ({
          ...prev,
          notebooks: prev.notebooks.filter((n) => n.id !== id),
          selectedNotebook:
            prev.selectedNotebook?.id === id ? null : prev.selectedNotebook,
        }));
        if (state.selectedNotebook?.id === id) {
          setDocuments([]);
        }
        return true;
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Failed to delete notebook',
        }));
        return false;
      }
    },
    [state.selectedNotebook?.id]
  );

  // Upload a document
  const uploadDocument = useCallback(
    async (file: File): Promise<boolean> => {
      if (!state.selectedNotebook) {
        setState((prev) => ({
          ...prev,
          error: 'No notebook selected',
        }));
        return false;
      }

      try {
        const response = await api.uploadDocument(state.selectedNotebook.id, file);
        if (response.success) {
          // Refresh documents
          const docsResponse = await api.getDocuments(state.selectedNotebook.id);
          setDocuments(docsResponse.documents);
          updateNotebookDocumentCount(state.selectedNotebook.id, docsResponse.documents.length);
          return true;
        }
        return false;
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Failed to upload document',
        }));
        return false;
      }
    },
    [state.selectedNotebook, updateNotebookDocumentCount]
  );

  // Delete a document
  const deleteDocument = useCallback(
    async (sourceId: string): Promise<boolean> => {
      if (!state.selectedNotebook) return false;

      try {
        await api.deleteDocument(state.selectedNotebook.id, sourceId);
        const docsResponse = await api.getDocuments(state.selectedNotebook.id);
        setDocuments(docsResponse.documents);
        updateNotebookDocumentCount(state.selectedNotebook.id, docsResponse.documents.length);
        return true;
      } catch (error) {
        console.error('Failed to delete document:', error);
        return false;
      }
    },
    [state.selectedNotebook, updateNotebookDocumentCount]
  );

  // Toggle document active state
  const toggleDocumentActive = useCallback(
    async (sourceId: string, active: boolean): Promise<boolean> => {
      if (!state.selectedNotebook) return false;

      try {
        const updated = await api.toggleDocumentActive(
          state.selectedNotebook.id,
          sourceId,
          active
        );
        setDocuments((prev) =>
          prev.map((d) => (d.source_id === sourceId ? updated : d))
        );
        return true;
      } catch (error) {
        console.error('Failed to toggle document:', error);
        return false;
      }
    },
    [state.selectedNotebook]
  );

  // Initial fetch
  useEffect(() => {
    fetchNotebooks();
  }, [fetchNotebooks]);

  return {
    ...state,
    documents,
    isLoadingDocs,
    fetchNotebooks,
    selectNotebook,
    createNotebook,
    updateNotebook,
    deleteNotebook,
    uploadDocument,
    deleteDocument,
    toggleDocumentActive,
  };
}
