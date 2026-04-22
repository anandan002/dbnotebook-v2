/**
 * Analytics Context for Excel data analysis and dashboard generation.
 *
 * Manages:
 * - File upload and parsing state
 * - Analysis progress and status
 * - Dashboard configuration
 * - Filter state and cross-filtering
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';

import type {
  AnalysisState,
  AnalysisSession,
  ParsedData,
  ProfilingResult,
  DashboardConfig,
  FilterState,
  CrossFilterEvent,
  UploadResponse,
  ParseResponse,
  ProfileResponse,
  AnalyzeResponse,
  SessionDataResponse,
  ModificationState,
  ModifyResponse,
} from '../types/analytics';
import { withBasePath } from '../utils/paths';

// API base URL
const API_BASE = withBasePath('/api/analytics');

// Context value interface
interface AnalyticsContextValue {
  // Session state
  sessionId: string | null;
  session: AnalysisSession | null;

  // Analysis state
  analysisState: AnalysisState;
  analysisProgress: number;
  error: string | null;

  // Data state
  parsedData: ParsedData | null;
  profilingResult: ProfilingResult | null;
  dashboardConfig: DashboardConfig | null;

  // Filter state
  filters: FilterState;
  filteredData: Record<string, any>[] | null;

  // Cross-filter state
  crossFilterEvent: CrossFilterEvent | null;

  // NLP Modification state
  initialRequirements: string | null;
  modificationState: ModificationState;
  isModifying: boolean;

  // Actions
  uploadFile: (file: File, notebookId?: string) => Promise<string | null>;
  parseFile: (sessionId: string) => Promise<boolean>;
  profileData: (sessionId: string, minimal?: boolean) => Promise<boolean>;
  analyzeDashboard: (sessionId: string, title?: string, requirements?: string) => Promise<boolean>;
  runFullAnalysis: (file: File, notebookId?: string, requirements?: string) => Promise<boolean>;
  loadSession: (sessionId: string) => Promise<boolean>;
  setFilters: (filters: FilterState) => void;
  updateFilter: (filterId: string, value: any) => void;
  clearFilters: () => void;
  setCrossFilter: (event: CrossFilterEvent | null) => void;
  resetDashboard: () => void;
  clearError: () => void;

  // NLP Modification actions
  setRequirements: (sessionId: string, requirements: string) => Promise<boolean>;
  modifyDashboard: (instruction: string) => Promise<boolean>;
  undoModification: () => Promise<boolean>;
  redoModification: () => Promise<boolean>;
}

const AnalyticsContext = createContext<AnalyticsContextValue | undefined>(undefined);

// Default modification state
const DEFAULT_MODIFICATION_STATE: ModificationState = {
  canUndo: false,
  canRedo: false,
  lastChanges: [],
};

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  // Session state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<AnalysisSession | null>(null);

  // Analysis state
  const [analysisState, setAnalysisState] = useState<AnalysisState>('idle');
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Data state
  const [parsedData, setParsedData] = useState<ParsedData | null>(null);
  const [profilingResult, setProfilingResult] = useState<ProfilingResult | null>(null);
  const [dashboardConfig, setDashboardConfig] = useState<DashboardConfig | null>(null);

  // Filter state
  const [filters, setFiltersState] = useState<FilterState>({});
  const [crossFilterEvent, setCrossFilterEvent] = useState<CrossFilterEvent | null>(null);

  // NLP Modification state
  const [initialRequirements, setInitialRequirements] = useState<string | null>(null);
  const [modificationState, setModificationState] = useState<ModificationState>(DEFAULT_MODIFICATION_STATE);
  const [isModifying, setIsModifying] = useState(false);

  // Compute filtered data based on current filters
  const filteredData = useMemo(() => {
    if (!parsedData?.data) return null;

    let data = [...parsedData.data];

    // Apply filters
    Object.entries(filters).forEach(([filterId, filterValue]) => {
      if (!filterValue?.value) return;

      // Find the filter config to get the column name
      const filterConfig = dashboardConfig?.filters.find((f) => f.id === filterId);
      if (!filterConfig) return;

      const column = filterConfig.column;

      if (filterValue.type === 'categorical' && Array.isArray(filterValue.value)) {
        if (filterValue.value.length > 0) {
          data = data.filter((row) => filterValue.value.includes(row[column]));
        }
      } else if (filterValue.type === 'range' && Array.isArray(filterValue.value)) {
        const [min, max] = filterValue.value;
        if (min !== undefined) {
          data = data.filter((row) => row[column] >= min);
        }
        if (max !== undefined) {
          data = data.filter((row) => row[column] <= max);
        }
      } else if (filterValue.type === 'date' && Array.isArray(filterValue.value)) {
        const [startDate, endDate] = filterValue.value;
        if (startDate) {
          data = data.filter((row) => new Date(row[column]) >= new Date(startDate));
        }
        if (endDate) {
          data = data.filter((row) => new Date(row[column]) <= new Date(endDate));
        }
      }
    });

    // Apply cross-filter if present
    if (crossFilterEvent) {
      const { filterColumn, filterValue, filterType } = crossFilterEvent;
      if (filterType === 'include') {
        data = data.filter((row) => row[filterColumn] === filterValue);
      } else {
        data = data.filter((row) => row[filterColumn] !== filterValue);
      }
    }

    return data;
  }, [parsedData, filters, crossFilterEvent, dashboardConfig]);

  // Upload file to create session
  const uploadFile = useCallback(async (file: File, notebookId?: string): Promise<string | null> => {
    setError(null);
    setAnalysisState('uploading');
    setAnalysisProgress(5);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const url = notebookId
        ? `${API_BASE}/upload?notebook_id=${notebookId}`
        : `${API_BASE}/upload`;

      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      const data: UploadResponse = await response.json();

      if (!data.success || !data.sessionId) {
        throw new Error(data.error || 'Failed to upload file');
      }

      setSessionId(data.sessionId);
      setAnalysisProgress(10);

      return data.sessionId;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      setAnalysisState('error');
      return null;
    }
  }, []);

  // Parse uploaded file
  const parseFile = useCallback(async (sid: string): Promise<boolean> => {
    setError(null);
    setAnalysisState('parsing');
    setAnalysisProgress(20);

    try {
      const response = await fetch(`${API_BASE}/parse/${sid}`, {
        method: 'POST',
      });

      const data: ParseResponse = await response.json();

      if (!data.success || !data.parsedData) {
        throw new Error(data.error || 'Failed to parse file');
      }

      setParsedData(data.parsedData);
      setAnalysisProgress(40);

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Parse failed';
      setError(message);
      setAnalysisState('error');
      return false;
    }
  }, []);

  // Profile data with ydata-profiling
  const profileData = useCallback(async (sid: string, minimal = false): Promise<boolean> => {
    setError(null);
    setAnalysisState('profiling');
    setAnalysisProgress(50);

    try {
      const url = minimal
        ? `${API_BASE}/profile/${sid}?minimal=true`
        : `${API_BASE}/profile/${sid}`;

      const response = await fetch(url, {
        method: 'POST',
      });

      const data: ProfileResponse = await response.json();

      if (!data.success || !data.profilingResult) {
        throw new Error(data.error || 'Failed to profile data');
      }

      setProfilingResult(data.profilingResult);
      setAnalysisProgress(70);

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Profiling failed';
      setError(message);
      setAnalysisState('error');
      return false;
    }
  }, []);

  // Generate dashboard with AI
  const analyzeDashboard = useCallback(async (sid: string, title?: string, requirements?: string): Promise<boolean> => {
    setError(null);
    setAnalysisState('analyzing');
    setAnalysisProgress(80);

    try {
      const response = await fetch(`${API_BASE}/analyze/${sid}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, requirements }),
      });

      const data: AnalyzeResponse = await response.json();

      if (!data.success || !data.dashboardConfig) {
        throw new Error(data.error || 'Failed to analyze dashboard');
      }

      setDashboardConfig(data.dashboardConfig);
      setAnalysisProgress(100);
      setAnalysisState('complete');

      // Store initial requirements and modification state
      if (requirements) {
        setInitialRequirements(requirements);
      }
      if (data.modificationState) {
        setModificationState(data.modificationState);
      }

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analysis failed';
      setError(message);
      setAnalysisState('error');
      return false;
    }
  }, []);

  // Run full analysis pipeline
  const runFullAnalysis = useCallback(async (file: File, notebookId?: string, requirements?: string): Promise<boolean> => {
    // Step 1: Upload
    const sid = await uploadFile(file, notebookId);
    if (!sid) return false;

    // Step 2: Parse
    const parsed = await parseFile(sid);
    if (!parsed) return false;

    // Step 3: Profile
    const profiled = await profileData(sid, true); // Use minimal for faster processing
    if (!profiled) return false;

    // Step 4: Analyze with optional requirements
    const analyzed = await analyzeDashboard(sid, file.name.replace(/\.[^/.]+$/, ''), requirements);
    if (!analyzed) return false;

    return true;
  }, [uploadFile, parseFile, profileData, analyzeDashboard]);

  // Load existing session
  const loadSession = useCallback(async (sid: string): Promise<boolean> => {
    setError(null);
    setAnalysisState('uploading');
    setAnalysisProgress(10);

    try {
      const response = await fetch(`${API_BASE}/sessions/${sid}/data`);
      const data: SessionDataResponse = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to load session');
      }

      setSessionId(sid);

      if (data.parsedData) {
        setParsedData(data.parsedData);
        setAnalysisProgress(40);
      }

      if (data.profilingResult) {
        setProfilingResult(data.profilingResult);
        setAnalysisProgress(70);
      }

      if (data.dashboardConfig) {
        setDashboardConfig(data.dashboardConfig);
        setAnalysisProgress(100);
        setAnalysisState('complete');
      } else if (data.profilingResult) {
        setAnalysisState('profiling');
      } else if (data.parsedData) {
        setAnalysisState('parsing');
      } else {
        setAnalysisState('idle');
      }

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load session';
      setError(message);
      setAnalysisState('error');
      return false;
    }
  }, []);

  // Set filters
  const setFilters = useCallback((newFilters: FilterState) => {
    setFiltersState(newFilters);
  }, []);

  // Update a single filter
  const updateFilter = useCallback((filterId: string, value: any) => {
    setFiltersState((prev) => ({
      ...prev,
      [filterId]: value,
    }));
  }, []);

  // Clear all filters
  const clearFilters = useCallback(() => {
    setFiltersState({});
    setCrossFilterEvent(null);
  }, []);

  // Set cross-filter event
  const setCrossFilter = useCallback((event: CrossFilterEvent | null) => {
    setCrossFilterEvent(event);
  }, []);

  // Reset everything
  const resetDashboard = useCallback(() => {
    setSessionId(null);
    setSession(null);
    setAnalysisState('idle');
    setAnalysisProgress(0);
    setError(null);
    setParsedData(null);
    setProfilingResult(null);
    setDashboardConfig(null);
    setFiltersState({});
    setCrossFilterEvent(null);
    // Reset modification state
    setInitialRequirements(null);
    setModificationState(DEFAULT_MODIFICATION_STATE);
    setIsModifying(false);
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // ========================================
  // NLP Modification Actions
  // ========================================

  // Set initial requirements for dashboard generation
  const setRequirementsAction = useCallback(async (sid: string, requirements: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE}/sessions/${sid}/requirements`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requirements }),
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to set requirements');
      }

      setInitialRequirements(requirements);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to set requirements';
      setError(message);
      return false;
    }
  }, []);

  // Modify dashboard via NLP instruction
  const modifyDashboard = useCallback(async (instruction: string): Promise<boolean> => {
    if (!sessionId) {
      setError('No active session');
      return false;
    }

    setIsModifying(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/sessions/${sessionId}/modify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ instruction }),
      });

      const data: ModifyResponse = await response.json();

      if (!data.success || !data.dashboardConfig) {
        throw new Error(data.error || 'Modification failed');
      }

      // Update dashboard config
      setDashboardConfig(data.dashboardConfig);

      // Update modification state
      setModificationState({
        canUndo: data.canUndo ?? false,
        canRedo: data.canRedo ?? false,
        lastChanges: data.changes ?? [],
      });

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Modification failed';
      setError(message);
      return false;
    } finally {
      setIsModifying(false);
    }
  }, [sessionId]);

  // Undo last dashboard modification
  const undoModification = useCallback(async (): Promise<boolean> => {
    if (!sessionId) {
      setError('No active session');
      return false;
    }

    setIsModifying(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/sessions/${sessionId}/undo`, {
        method: 'POST',
      });

      const data: ModifyResponse = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Undo failed');
      }

      if (data.dashboardConfig) {
        setDashboardConfig(data.dashboardConfig);
      }

      setModificationState({
        canUndo: data.canUndo ?? false,
        canRedo: data.canRedo ?? false,
        lastChanges: data.changes ?? [],
      });

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Undo failed';
      setError(message);
      return false;
    } finally {
      setIsModifying(false);
    }
  }, [sessionId]);

  // Redo previously undone modification
  const redoModification = useCallback(async (): Promise<boolean> => {
    if (!sessionId) {
      setError('No active session');
      return false;
    }

    setIsModifying(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/sessions/${sessionId}/redo`, {
        method: 'POST',
      });

      const data: ModifyResponse = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Redo failed');
      }

      if (data.dashboardConfig) {
        setDashboardConfig(data.dashboardConfig);
      }

      setModificationState({
        canUndo: data.canUndo ?? false,
        canRedo: data.canRedo ?? false,
        lastChanges: data.changes ?? [],
      });

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Redo failed';
      setError(message);
      return false;
    } finally {
      setIsModifying(false);
    }
  }, [sessionId]);

  const value: AnalyticsContextValue = {
    // Session state
    sessionId,
    session,

    // Analysis state
    analysisState,
    analysisProgress,
    error,

    // Data state
    parsedData,
    profilingResult,
    dashboardConfig,

    // Filter state
    filters,
    filteredData,
    crossFilterEvent,

    // NLP Modification state
    initialRequirements,
    modificationState,
    isModifying,

    // Actions
    uploadFile,
    parseFile,
    profileData,
    analyzeDashboard,
    runFullAnalysis,
    loadSession,
    setFilters,
    updateFilter,
    clearFilters,
    setCrossFilter,
    resetDashboard,
    clearError,

    // NLP Modification actions
    setRequirements: setRequirementsAction,
    modifyDashboard,
    undoModification,
    redoModification,
  };

  return (
    <AnalyticsContext.Provider value={value}>
      {children}
    </AnalyticsContext.Provider>
  );
}

// Hook to use the analytics context
export function useAnalytics(): AnalyticsContextValue {
  const context = useContext(AnalyticsContext);
  if (context === undefined) {
    throw new Error('useAnalytics must be used within an AnalyticsProvider');
  }
  return context;
}

// Hook for cross-filter functionality
export function useCrossFilter() {
  const { crossFilterEvent, setCrossFilter, filteredData } = useAnalytics();

  const applyCrossFilter = useCallback(
    (chartId: string, column: string, value: any) => {
      // Toggle off if clicking the same value
      if (
        crossFilterEvent?.sourceChartId === chartId &&
        crossFilterEvent?.filterValue === value
      ) {
        setCrossFilter(null);
      } else {
        setCrossFilter({
          sourceChartId: chartId,
          filterColumn: column,
          filterValue: value,
          filterType: 'include',
        });
      }
    },
    [crossFilterEvent, setCrossFilter]
  );

  const clearCrossFilter = useCallback(() => {
    setCrossFilter(null);
  }, [setCrossFilter]);

  return {
    crossFilterEvent,
    applyCrossFilter,
    clearCrossFilter,
    filteredData,
    isFiltering: crossFilterEvent !== null,
  };
}

export default AnalyticsContext;
