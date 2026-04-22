/**
 * Retrieval Settings Component
 *
 * Shared settings panel for RAG retrieval configuration:
 * - Reranker: enable/disable and model selection (local + Groq if enabled)
 * - RAPTOR: enable/disable hierarchical summaries
 * - Top-K: number of results to retrieve
 *
 * Used by both RAG Chat and SQL Chat.
 * Fetches available reranker models from API based on config/models.yaml
 */

import { useState, useCallback, useEffect } from 'react';
import { ChevronDown, ChevronUp, Sliders, Zap, TreePine, Hash, Cloud } from 'lucide-react';
import { withBasePath } from '../../utils/paths';

interface RerankerModel {
  id: string;
  name: string;
  type: 'local' | 'groq' | 'disabled';
  description: string;
}

export interface RetrievalConfig {
  rerankerEnabled: boolean;
  rerankerModel: string;  // Now accepts any model id including groq:*
  raptorEnabled: boolean;
  topK: number;
}

export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
  rerankerEnabled: true,
  rerankerModel: 'base',
  raptorEnabled: true,
  topK: 6,
};

interface RetrievalSettingsProps {
  config: RetrievalConfig;
  onChange: (config: RetrievalConfig) => void;
  disabled?: boolean;
  compact?: boolean; // For inline use in SQL Chat
  className?: string;
}

// Fallback models if API fails
const FALLBACK_MODELS: RerankerModel[] = [
  { id: 'xsmall', name: 'XSmall', type: 'local', description: 'Fastest' },
  { id: 'base', name: 'Base', type: 'local', description: 'Balanced' },
  { id: 'large', name: 'Large', type: 'local', description: 'Best local' },
];

export function RetrievalSettings({
  config,
  onChange,
  disabled = false,
  compact = false,
  className = '',
}: RetrievalSettingsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [availableModels, setAvailableModels] = useState<RerankerModel[]>(FALLBACK_MODELS);

  // Fetch available models from API on mount
  useEffect(() => {
    fetch(withBasePath('/api/settings/reranker'))
      .then(res => res.json())
      .then(data => {
        if (data.success && data.available_models) {
          // Filter out 'disabled' type for the model list (we handle disable via toggle)
          const models = data.available_models.filter(
            (m: RerankerModel) => m.type !== 'disabled'
          );
          if (models.length > 0) {
            setAvailableModels(models);
          }
        }
      })
      .catch(err => {
        console.warn('Failed to fetch reranker models:', err);
      });
  }, []);

  const handleRerankerToggle = useCallback(() => {
    onChange({ ...config, rerankerEnabled: !config.rerankerEnabled });
  }, [config, onChange]);

  const handleRerankerModelChange = useCallback(
    (model: string) => {
      onChange({ ...config, rerankerModel: model });
    },
    [config, onChange]
  );

  // Group models by type for display
  const localModels = availableModels.filter(m => m.type === 'local');
  const groqModels = availableModels.filter(m => m.type === 'groq');

  const handleRaptorToggle = useCallback(() => {
    onChange({ ...config, raptorEnabled: !config.raptorEnabled });
  }, [config, onChange]);

  const handleTopKChange = useCallback(
    (value: number) => {
      onChange({ ...config, topK: Math.max(1, Math.min(20, value)) });
    },
    [config, onChange]
  );

  // Check if settings differ from defaults
  const hasCustomSettings =
    config.rerankerEnabled !== DEFAULT_RETRIEVAL_CONFIG.rerankerEnabled ||
    config.rerankerModel !== DEFAULT_RETRIEVAL_CONFIG.rerankerModel ||
    config.raptorEnabled !== DEFAULT_RETRIEVAL_CONFIG.raptorEnabled ||
    config.topK !== DEFAULT_RETRIEVAL_CONFIG.topK;

  const toggleButton = (
    <button
      onClick={() => setIsExpanded(!isExpanded)}
      disabled={disabled}
      className={`
        flex items-center gap-2 text-xs font-medium transition-colors
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:text-glow cursor-pointer'}
        ${hasCustomSettings ? 'text-glow' : 'text-text-muted'}
      `}
    >
      <Sliders size={14} />
      <span>Retrieval Settings</span>
      {hasCustomSettings && (
        <span className="px-1.5 py-0.5 bg-glow/20 text-glow rounded text-[10px]">
          Custom
        </span>
      )}
      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </button>
  );

  const settingsPanel = (
    <div
      className={`
        ${compact ? 'p-3' : 'p-4'} rounded-lg border border-void-surface bg-void-light
        ${disabled ? 'opacity-50 pointer-events-none' : ''}
      `}
    >
      {/* Reranker Section */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-amber-400" />
            <label className="text-xs font-medium text-text">Reranker</label>
          </div>
          <button
            onClick={handleRerankerToggle}
            className={`
              relative w-10 h-5 rounded-full transition-colors
              ${config.rerankerEnabled ? 'bg-glow' : 'bg-void-surface'}
            `}
          >
            <span
              className={`
                absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform
                ${config.rerankerEnabled ? 'left-5' : 'left-0.5'}
              `}
            />
          </button>
        </div>

        {config.rerankerEnabled && (
          <div className="space-y-2">
            {/* Local Models */}
            <div className="flex gap-1 p-1 bg-void-surface/50 rounded-lg">
              {localModels.map((model) => (
                <button
                  key={model.id}
                  onClick={() => handleRerankerModelChange(model.id)}
                  title={model.description}
                  className={`
                    flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-all
                    ${
                      config.rerankerModel === model.id
                        ? 'bg-glow text-void shadow-sm'
                        : 'text-text-muted hover:text-text hover:bg-void-lighter'
                    }
                  `}
                >
                  {model.name}
                </button>
              ))}
            </div>

            {/* Groq Models (if available) */}
            {groqModels.length > 0 && (
              <>
                <div className="flex items-center gap-2 mt-2">
                  <Cloud size={12} className="text-cyan-400" />
                  <span className="text-[10px] text-text-dim">Groq Cloud (faster)</span>
                </div>
                <div className="flex gap-1 p-1 bg-void-surface/50 rounded-lg">
                  {groqModels.map((model) => (
                    <button
                      key={model.id}
                      onClick={() => handleRerankerModelChange(model.id)}
                      title={model.description}
                      className={`
                        flex-1 py-1.5 px-2 text-xs font-medium rounded-md transition-all
                        ${
                          config.rerankerModel === model.id
                            ? 'bg-cyan-500 text-void shadow-sm'
                            : 'text-text-muted hover:text-text hover:bg-void-lighter'
                        }
                      `}
                    >
                      {model.name.replace('Groq ', '')}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* RAPTOR Section */}
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TreePine size={14} className="text-green-400" />
            <label className="text-xs font-medium text-text">RAPTOR Summaries</label>
          </div>
          <button
            onClick={handleRaptorToggle}
            className={`
              relative w-10 h-5 rounded-full transition-colors
              ${config.raptorEnabled ? 'bg-glow' : 'bg-void-surface'}
            `}
          >
            <span
              className={`
                absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform
                ${config.raptorEnabled ? 'left-5' : 'left-0.5'}
              `}
            />
          </button>
        </div>
        <p className="text-[10px] text-text-dim mt-1">
          Include hierarchical document summaries for better context
        </p>
      </div>

      {/* Top-K Section */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Hash size={14} className="text-cyan-400" />
            <label className="text-xs font-medium text-text">Top-K Results</label>
          </div>
          <span className="text-xs text-text-muted font-mono">{config.topK}</span>
        </div>
        <input
          type="range"
          min="1"
          max="20"
          value={config.topK}
          onChange={(e) => handleTopKChange(Number(e.target.value))}
          className="query-slider w-full"
        />
        <div className="flex justify-between text-[10px] text-text-dim mt-1">
          <span>Focused (1)</span>
          <span>Broad (20)</span>
        </div>
      </div>

      {/* Reset Button */}
      {hasCustomSettings && (
        <button
          onClick={() => onChange(DEFAULT_RETRIEVAL_CONFIG)}
          className="w-full py-2 text-xs text-text-muted hover:text-text
            border border-void-surface hover:border-text-dim rounded-md transition-colors"
        >
          Reset to Defaults
        </button>
      )}
    </div>
  );

  if (compact) {
    // Compact mode: always visible, no toggle
    return (
      <div className={className}>
        {settingsPanel}
      </div>
    );
  }

  return (
    <div className={className}>
      {toggleButton}
      {isExpanded && <div className="mt-3">{settingsPanel}</div>}
    </div>
  );
}

export default RetrievalSettings;
