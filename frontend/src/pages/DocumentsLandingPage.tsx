/**
 * Documents Landing Page
 *
 * Three-panel layout for document and notebook management:
 * - Left panel: Notebook list with search and create
 * - Middle panel: Selected notebook's documents with full CRUD
 * - Right panel: Document preview with markdown/PDF rendering (resizable)
 */

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  Search,
  Plus,
  FolderOpen,
  FileText,
  Trash2,
  Edit2,
  Check,
  X,
  Upload,
  Loader2,
  Globe,
  ChevronRight,
  Eye,
  XCircle,
  GripVertical
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Document, Page, pdfjs } from 'react-pdf';
import { Header } from '../components/Header';
import { MainLayout } from '../components/Layout';
import { useNotebook } from '../contexts';
import { useNotebooks } from '../hooks/useNotebooks';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ui';
import { WebSearchPanel } from '../components/Sidebar/WebSearchPanel';
import { getDocumentContent } from '../services/api';
import type { Notebook, Document as DocType } from '../types';

// Set up PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

// Custom Markdown components for styling
const MarkdownComponents = {
  h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="text-2xl font-bold text-text mt-6 mb-4 pb-2 border-b border-void-lighter" {...props}>{children}</h1>
  ),
  h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="text-xl font-semibold text-text mt-5 mb-3" {...props}>{children}</h2>
  ),
  h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="text-lg font-medium text-text mt-4 mb-2" {...props}>{children}</h3>
  ),
  p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="text-text-muted leading-relaxed mb-4" {...props}>{children}</p>
  ),
  ul: ({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="list-disc list-inside text-text-muted mb-4 space-y-1" {...props}>{children}</ul>
  ),
  ol: ({ children, ...props }: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="list-decimal list-inside text-text-muted mb-4 space-y-1" {...props}>{children}</ol>
  ),
  li: ({ children, ...props }: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="text-text-muted" {...props}>{children}</li>
  ),
  blockquote: ({ children, ...props }: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote className="border-l-4 border-glow/50 pl-4 italic text-text-dim my-4" {...props}>{children}</blockquote>
  ),
  code: ({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) => {
    const isInline = !className;
    if (isInline) {
      return <code className="bg-void-surface px-1.5 py-0.5 rounded text-sm text-nebula font-mono" {...props}>{children}</code>;
    }
    return (
      <code className="block bg-void-surface p-4 rounded-lg text-sm overflow-x-auto font-mono text-text-muted" {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => (
    <pre className="bg-void-surface p-4 rounded-lg overflow-x-auto mb-4" {...props}>{children}</pre>
  ),
  a: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} className="text-glow hover:underline" target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
  ),
  table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="overflow-x-auto mb-4">
      <table className="min-w-full border border-void-lighter" {...props}>{children}</table>
    </div>
  ),
  th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th className="border border-void-lighter bg-void-surface px-4 py-2 text-left text-text font-medium" {...props}>{children}</th>
  ),
  td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td className="border border-void-lighter px-4 py-2 text-text-muted" {...props}>{children}</td>
  ),
};

export function DocumentsLandingPage() {
  const { notebooks } = useNotebook();
  const {
    createNotebook,
    updateNotebook,
    deleteNotebook,
    uploadDocument,
    deleteDocument,
    toggleDocumentActive,
    selectNotebook,
    selectedNotebook,
    documents,
    isLoading,
    isLoadingDocs
  } = useNotebooks();
  const { toasts, removeToast, success, error: showError } = useToast();

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreatingNotebook, setIsCreatingNotebook] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState('');
  const [editingNotebookId, setEditingNotebookId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [showWebSearch, setShowWebSearch] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Preview state
  const [previewDoc, setPreviewDoc] = useState<DocType | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Resizable panel state
  const [previewWidth, setPreviewWidth] = useState(500);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);

  // PDF state
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Filter notebooks by search
  const filteredNotebooks = useMemo(() => {
    if (!searchQuery.trim()) return notebooks;
    const query = searchQuery.toLowerCase();
    return notebooks.filter(nb =>
      nb.name.toLowerCase().includes(query)
    );
  }, [notebooks, searchQuery]);

  // Load preview content when previewDoc changes
  useEffect(() => {
    if (!previewDoc || !selectedNotebook) {
      setPreviewContent('');
      setPreviewError(null);
      return;
    }

    const loadContent = async () => {
      setIsLoadingPreview(true);
      setPreviewError(null);
      setPdfError(null);

      try {
        const result = await getDocumentContent(selectedNotebook.id, previewDoc.source_id);
        setPreviewContent(result.content);
      } catch (err) {
        console.error('Failed to load document content:', err);
        setPreviewError('Failed to load document content');
        setPreviewContent('');
      } finally {
        setIsLoadingPreview(false);
      }
    };

    loadContent();
  }, [previewDoc, selectedNotebook]);

  // Clear preview when notebook changes
  useEffect(() => {
    setPreviewDoc(null);
    setPreviewContent('');
    setPreviewError(null);
  }, [selectedNotebook?.id]);

  // Resizable panel handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const containerWidth = window.innerWidth;
      const newWidth = containerWidth - e.clientX;

      // Constrain between 300px and 60% of window
      const minWidth = 300;
      const maxWidth = containerWidth * 0.6;
      setPreviewWidth(Math.max(minWidth, Math.min(maxWidth, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  // PDF handlers
  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPdfError(null);
  };

  const onDocumentLoadError = (error: Error) => {
    console.error('PDF load error:', error);
    setPdfError('Failed to load PDF. Displaying text content instead.');
  };

  // Notebook CRUD handlers
  const handleCreateNotebook = async () => {
    if (!newNotebookName.trim()) return;

    const notebook = await createNotebook(newNotebookName.trim());
    if (notebook) {
      success(`Created: ${notebook.name}`);
      setNewNotebookName('');
      setIsCreatingNotebook(false);
      selectNotebook(notebook);
    } else {
      showError('Failed to create notebook');
    }
  };

  const handleRenameNotebook = async (id: string) => {
    if (!editingName.trim()) {
      setEditingNotebookId(null);
      return;
    }

    const result = await updateNotebook(id, { name: editingName.trim() });
    if (result) {
      success('Notebook renamed');
      setEditingNotebookId(null);
    } else {
      showError('Failed to rename notebook');
    }
  };

  const handleDeleteNotebook = async (notebook: Notebook) => {
    if (!window.confirm(`Delete "${notebook.name}" and all its documents?`)) return;

    const result = await deleteNotebook(notebook.id);
    if (result) {
      success('Notebook deleted');
      if (selectedNotebook?.id === notebook.id) {
        selectNotebook(null);
      }
    } else {
      showError('Failed to delete notebook');
    }
  };

  // Document handlers
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    let successCount = 0;

    for (const file of Array.from(files)) {
      const result = await uploadDocument(file);
      if (result) successCount++;
    }

    if (successCount > 0) {
      success(`Uploaded ${successCount} file${successCount > 1 ? 's' : ''}`);
    }
    if (successCount < files.length) {
      showError(`Failed to upload ${files.length - successCount} file(s)`);
    }

    setIsUploading(false);
    e.target.value = '';
  };

  const handleDeleteDocument = async (doc: DocType) => {
    if (!window.confirm(`Remove "${doc.filename}"?`)) return;

    const result = await deleteDocument(doc.source_id);
    if (result) {
      success('Document removed');
      if (previewDoc?.source_id === doc.source_id) {
        setPreviewDoc(null);
      }
    } else {
      showError('Failed to remove document');
    }
  };

  const handleToggleDocument = async (doc: DocType) => {
    const result = await toggleDocumentActive(doc.source_id, !(doc.active !== false));
    if (!result) {
      showError('Failed to update document');
    }
  };

  const handleWebSourcesAdded = () => {
    if (selectedNotebook) {
      selectNotebook(selectedNotebook);
    }
    success('Web content added');
    setShowWebSearch(false);
  };

  const startEditing = (notebook: Notebook) => {
    setEditingNotebookId(notebook.id);
    setEditingName(notebook.name);
  };

  const handleDocumentClick = (doc: DocType) => {
    if (previewDoc?.source_id === doc.source_id) {
      // Toggle off if same doc
      setPreviewDoc(null);
    } else {
      setPreviewDoc(doc);
    }
  };

  const isPdfFile = (filename: string) => {
    return filename.toLowerCase().endsWith('.pdf');
  };

  // Render preview content based on file type
  const renderPreviewContent = () => {
    if (isLoadingPreview) {
      return (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-8 h-8 animate-spin text-glow" />
        </div>
      );
    }

    if (previewError) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center p-8">
          <XCircle className="w-12 h-12 text-danger mb-4" />
          <p className="text-text-muted">{previewError}</p>
        </div>
      );
    }

    if (!previewContent) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center p-8">
          <FileText className="w-12 h-12 text-text-dim mb-4" />
          <p className="text-text-muted">No content to display</p>
        </div>
      );
    }

    // Check if it's a PDF
    if (previewDoc && isPdfFile(previewDoc.filename)) {
      // For PDFs, we try to render with react-pdf, but also show text content as fallback
      return (
        <div className="h-full overflow-y-auto">
          {pdfError ? (
            // Fallback to text content
            <div className="p-6">
              <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-sm">
                {pdfError}
              </div>
              <div className="prose prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
                  {previewContent}
                </ReactMarkdown>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <Document
                file={`/api/notebooks/${selectedNotebook?.id}/documents/${previewDoc.source_id}/pdf`}
                onLoadSuccess={onDocumentLoadSuccess}
                onLoadError={onDocumentLoadError}
                loading={
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-glow" />
                  </div>
                }
              >
                {numPages && Array.from(new Array(numPages), (_, index) => (
                  <Page
                    key={`page_${index + 1}`}
                    pageNumber={index + 1}
                    className="mb-4 shadow-lg"
                    width={previewWidth - 48}
                  />
                ))}
              </Document>
              {numPages && (
                <div className="text-center text-text-dim text-sm mt-4">
                  {numPages} page{numPages !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    // For non-PDF files, render as markdown
    return (
      <div className="p-6 overflow-y-auto h-full">
        <div className="prose prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
            {previewContent}
          </ReactMarkdown>
        </div>
      </div>
    );
  };

  return (
    <MainLayout header={<Header />}>
      <div className="flex h-[calc(100vh-3.5rem)]">
        {/* Left Panel - Notebook List */}
        <div className="w-80 border-r border-void-lighter flex flex-col bg-void-light shrink-0">
          {/* Search & Create Header */}
          <div className="p-4 border-b border-void-lighter space-y-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search notebooks..."
                className="w-full pl-10 pr-4 py-2 bg-void-surface border border-void-lighter rounded-lg text-sm text-text placeholder-text-dim focus:outline-none focus:border-glow"
              />
            </div>

            {/* Create Button */}
            {!isCreatingNotebook ? (
              <button
                onClick={() => setIsCreatingNotebook(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-glow/10 text-glow rounded-lg hover:bg-glow/20 transition-colors text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                New Notebook
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newNotebookName}
                  onChange={(e) => setNewNotebookName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateNotebook();
                    if (e.key === 'Escape') {
                      setIsCreatingNotebook(false);
                      setNewNotebookName('');
                    }
                  }}
                  placeholder="Notebook name..."
                  autoFocus
                  className="flex-1 px-3 py-2 bg-void-surface border border-void-lighter rounded-lg text-sm text-text placeholder-text-dim focus:outline-none focus:border-glow"
                />
                <button
                  onClick={handleCreateNotebook}
                  disabled={!newNotebookName.trim()}
                  className="p-2 text-glow hover:bg-glow/10 rounded-lg disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setIsCreatingNotebook(false);
                    setNewNotebookName('');
                  }}
                  className="p-2 text-text-dim hover:text-text rounded-lg"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* Notebook List */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-glow" />
              </div>
            ) : filteredNotebooks.length === 0 ? (
              <div className="p-4 text-center text-text-dim text-sm">
                {searchQuery ? 'No notebooks match your search' : 'No notebooks yet'}
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {filteredNotebooks.map((notebook) => (
                  <div
                    key={notebook.id}
                    className={`
                      group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer
                      transition-all duration-150
                      ${selectedNotebook?.id === notebook.id
                        ? 'bg-glow/10 border border-glow/30'
                        : 'hover:bg-void-surface border border-transparent'
                      }
                    `}
                    onClick={() => selectNotebook(notebook)}
                  >
                    {editingNotebookId === notebook.id ? (
                      // Editing mode
                      <div className="flex-1 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameNotebook(notebook.id);
                            if (e.key === 'Escape') setEditingNotebookId(null);
                          }}
                          autoFocus
                          className="flex-1 px-2 py-1 bg-void-surface border border-void-lighter rounded text-sm text-text focus:outline-none focus:border-glow"
                        />
                        <button
                          onClick={() => handleRenameNotebook(notebook.id)}
                          className="p-1 text-glow hover:bg-glow/10 rounded"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingNotebookId(null)}
                          className="p-1 text-text-dim hover:text-text rounded"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      // Display mode
                      <>
                        <div className={`
                          w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
                          ${selectedNotebook?.id === notebook.id ? 'bg-glow/20' : 'bg-void-surface'}
                        `}>
                          <FolderOpen className={`w-4 h-4 ${selectedNotebook?.id === notebook.id ? 'text-glow' : 'text-text-muted'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate ${selectedNotebook?.id === notebook.id ? 'text-glow' : 'text-text'}`}>
                            {notebook.name}
                          </div>
                          <div className="text-xs text-text-dim">
                            {notebook.documentCount || 0} doc{notebook.documentCount !== 1 ? 's' : ''}
                          </div>
                        </div>
                        {/* Actions - show on hover */}
                        <div className="hidden group-hover:flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => startEditing(notebook)}
                            className="p-1.5 text-text-dim hover:text-text hover:bg-void-lighter rounded"
                            title="Rename"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteNotebook(notebook)}
                            className="p-1.5 text-text-dim hover:text-danger hover:bg-danger/10 rounded"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {/* Chevron when not hovering */}
                        <ChevronRight className={`w-4 h-4 group-hover:hidden ${selectedNotebook?.id === notebook.id ? 'text-glow' : 'text-text-dim'}`} />
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notebook count footer */}
          <div className="p-3 border-t border-void-lighter text-xs text-text-dim text-center">
            {notebooks.length} notebook{notebooks.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Middle Panel - Document Management */}
        <div className={`flex-1 flex flex-col overflow-hidden ${previewDoc ? '' : ''}`}>
          {!selectedNotebook ? (
            // No notebook selected
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <FolderOpen className="w-16 h-16 text-text-dim mx-auto mb-4" />
                <h2 className="text-xl font-medium text-text mb-2">Select a Notebook</h2>
                <p className="text-text-muted mb-6">
                  Choose a notebook from the left to manage its documents
                </p>
                {notebooks.length === 0 && (
                  <button
                    onClick={() => setIsCreatingNotebook(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-glow/10 text-glow rounded-lg hover:bg-glow/20 transition-colors"
                  >
                    <Plus className="w-5 h-5" />
                    Create Your First Notebook
                  </button>
                )}
              </div>
            </div>
          ) : (
            // Notebook selected - show documents
            <>
              {/* Document Header */}
              <div className="p-6 border-b border-void-lighter">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-semibold text-text">{selectedNotebook.name}</h2>
                    <p className="text-sm text-text-muted mt-1">
                      {documents.length} document{documents.length !== 1 ? 's' : ''} in this notebook
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Web Search Button */}
                    <button
                      onClick={() => setShowWebSearch(!showWebSearch)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                        showWebSearch
                          ? 'bg-purple-500/20 text-purple-400'
                          : 'bg-void-surface text-text-muted hover:text-text'
                      }`}
                    >
                      <Globe className="w-4 h-4" />
                      Add from Web
                    </button>

                    {/* Upload Button */}
                    <label className="flex items-center gap-2 px-4 py-2 bg-glow text-void rounded-lg hover:bg-glow/90 transition-colors cursor-pointer">
                      {isUploading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Upload className="w-4 h-4" />
                      )}
                      Upload Files
                      <input
                        type="file"
                        multiple
                        onChange={handleFileUpload}
                        className="hidden"
                        accept=".pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.xls"
                      />
                    </label>
                  </div>
                </div>

                {/* Web Search Panel */}
                {showWebSearch && (
                  <div className="mt-4 p-4 bg-void-surface rounded-lg border border-void-lighter">
                    <WebSearchPanel
                      notebookId={selectedNotebook.id}
                      onSourcesAdded={handleWebSourcesAdded}
                    />
                  </div>
                )}
              </div>

              {/* Document List */}
              <div className="flex-1 overflow-y-auto p-6">
                {isLoadingDocs ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-glow" />
                  </div>
                ) : documents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <FileText className="w-16 h-16 text-text-dim mb-4" />
                    <h3 className="text-lg font-medium text-text mb-2">No documents yet</h3>
                    <p className="text-text-muted mb-6 max-w-md">
                      Upload files or add web content to this notebook for RAG queries
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setShowWebSearch(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-void-surface text-text rounded-lg hover:bg-void-lighter transition-colors"
                      >
                        <Globe className="w-4 h-4" />
                        Add from Web
                      </button>
                      <label className="flex items-center gap-2 px-4 py-2 bg-glow text-void rounded-lg hover:bg-glow/90 transition-colors cursor-pointer">
                        <Upload className="w-4 h-4" />
                        Upload Files
                        <input
                          type="file"
                          multiple
                          onChange={handleFileUpload}
                          className="hidden"
                          accept=".pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.xls"
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {documents.map((doc) => (
                      <div
                        key={doc.source_id}
                        onClick={() => handleDocumentClick(doc)}
                        className={`
                          flex items-center gap-4 p-4 rounded-lg border transition-all cursor-pointer
                          ${previewDoc?.source_id === doc.source_id
                            ? 'bg-nebula/10 border-nebula/30'
                            : doc.active !== false
                              ? 'bg-void-surface border-void-lighter hover:border-void-light'
                              : 'bg-void-light border-void-lighter opacity-60 hover:border-void-light'
                          }
                        `}
                      >
                        {/* File icon */}
                        <div className={`
                          w-10 h-10 rounded-lg flex items-center justify-center
                          ${previewDoc?.source_id === doc.source_id
                            ? 'bg-nebula/20'
                            : doc.active !== false ? 'bg-nebula/10' : 'bg-void-lighter'
                          }
                        `}>
                          <FileText className={`w-5 h-5 ${
                            previewDoc?.source_id === doc.source_id
                              ? 'text-nebula'
                              : doc.active !== false ? 'text-nebula' : 'text-text-dim'
                          }`} />
                        </div>

                        {/* File info */}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-text truncate">
                            {doc.filename}
                          </div>
                          <div className="text-xs text-text-dim">
                            {doc.file_type || 'Document'}
                            {doc.active === false && ' • Disabled'}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          {/* Preview button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDocumentClick(doc);
                            }}
                            className={`
                              p-2 rounded-lg transition-colors
                              ${previewDoc?.source_id === doc.source_id
                                ? 'bg-nebula/20 text-nebula'
                                : 'text-text-dim hover:text-nebula hover:bg-nebula/10'
                              }
                            `}
                            title="Preview document"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Toggle active */}
                          <button
                            onClick={() => handleToggleDocument(doc)}
                            className={`
                              px-3 py-1.5 text-xs rounded-lg transition-colors
                              ${doc.active !== false
                                ? 'bg-glow/10 text-glow hover:bg-glow/20'
                                : 'bg-void-lighter text-text-dim hover:text-text'
                              }
                            `}
                          >
                            {doc.active !== false ? 'Active' : 'Enable'}
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => handleDeleteDocument(doc)}
                            className="p-2 text-text-dim hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
                            title="Remove document"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Preview Panel - Resizable */}
        {previewDoc && (
          <>
            {/* Resize handle */}
            <div
              ref={resizeRef}
              onMouseDown={handleMouseDown}
              className={`
                w-1 cursor-col-resize flex items-center justify-center
                bg-void-lighter hover:bg-glow/30 transition-colors
                ${isResizing ? 'bg-glow/50' : ''}
              `}
            >
              <GripVertical className="w-3 h-3 text-text-dim" />
            </div>

            {/* Preview content */}
            <div
              className="flex flex-col bg-void-light border-l border-void-lighter overflow-hidden"
              style={{ width: previewWidth }}
            >
              {/* Preview header */}
              <div className="p-4 border-b border-void-lighter flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-nebula/10 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-nebula" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium text-text truncate">
                      {previewDoc.filename}
                    </h3>
                    <p className="text-xs text-text-dim">
                      {previewDoc.file_type || 'Document'} Preview
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setPreviewDoc(null)}
                  className="p-2 text-text-dim hover:text-text hover:bg-void-surface rounded-lg transition-colors"
                  title="Close preview"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              {/* Preview content area */}
              <div className="flex-1 overflow-hidden">
                {renderPreviewContent()}
              </div>
            </div>
          </>
        )}
      </div>
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </MainLayout>
  );
}

export default DocumentsLandingPage;
