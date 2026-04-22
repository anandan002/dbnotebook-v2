/**
 * Hook for fetching AI-powered query suggestions from the agent API.
 *
 * Provides dynamic suggestions based on notebook context and document content.
 */

import { useState, useEffect, useCallback } from 'react';
import { withBasePath } from '../utils/paths';

export interface QuerySuggestion {
  type: 'specificity' | 'follow_up' | 'comparison' | 'exploration' | 'action';
  text: string;
  reason: string;
}

interface UseAgentSuggestionsOptions {
  notebookId?: string;
  query?: string;
  enabled?: boolean;
}

interface UseAgentSuggestionsReturn {
  suggestions: QuerySuggestion[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useAgentSuggestions({
  notebookId,
  query,
  enabled = true,
}: UseAgentSuggestionsOptions): UseAgentSuggestionsReturn {
  const [suggestions, setSuggestions] = useState<QuerySuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSuggestions = useCallback(async () => {
    const normalizedQuery = (query || '').trim();

    if (!enabled || !notebookId || !normalizedQuery) {
      setSuggestions([]);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(withBasePath('/api/agents/refine-query'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: normalizedQuery,
          notebook_context: { notebook_id: notebookId },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch suggestions');
      }

      const data = await response.json();

      if (data.success && data.suggestions) {
        setSuggestions(data.suggestions.slice(0, 4)); // Limit to 4 suggestions
      } else {
        setSuggestions([]);
      }
    } catch (err) {
      console.error('Error fetching suggestions:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch suggestions');
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  }, [notebookId, query, enabled]);

  // Fetch suggestions when notebook changes
  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  return {
    suggestions,
    isLoading,
    error,
    refresh: fetchSuggestions,
  };
}

/**
 * Hook for analyzing a query and getting follow-up suggestions.
 */
export function useQueryAnalysis() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const analyzeQuery = useCallback(async (query: string): Promise<{
    intent: string;
    complexity: number;
    refinements: string[];
  } | null> => {
    if (!query.trim()) return null;

    setIsAnalyzing(true);

    try {
      const response = await fetch(withBasePath('/api/agents/analyze-query'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        throw new Error('Failed to analyze query');
      }

      const data = await response.json();

      if (data.success) {
        return {
          intent: data.intent || 'unknown',
          complexity: data.complexity || 0,
          refinements: data.suggested_refinements || [],
        };
      }
      return null;
    } catch (err) {
      console.error('Error analyzing query:', err);
      return null;
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  return {
    analyzeQuery,
    isAnalyzing,
  };
}

export default useAgentSuggestions;
