import { useState, useEffect } from 'react';
import {
  Lightbulb,
  BookOpen,
  Target,
  FileText,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Sparkles,
  GraduationCap
} from 'lucide-react';
import type {
  ImprovementSuggestionsResponse,
  LLMSuggestion,
  StudyResource,
  TopicSections
} from '../../../types/quiz';
import { withBasePath } from '../../../utils/paths';

interface ImprovementSuggestionsProps {
  attemptId: string;
}

export function ImprovementSuggestions({ attemptId }: ImprovementSuggestionsProps) {
  const [suggestions, setSuggestions] = useState<ImprovementSuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchSuggestions = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(withBasePath(`/api/quiz/attempt/${attemptId}/suggestions`));
        const data = await response.json();

        if (data.success) {
          setSuggestions(data);
          // Expand first topic by default for document-linked
          if (data.type === 'document_linked' && data.sections?.length > 0) {
            setExpandedTopics(new Set([data.sections[0].topic]));
          }
        } else {
          setError(data.error || 'Failed to load suggestions');
        }
      } catch (err) {
        setError('Failed to load improvement suggestions');
        console.error('Error fetching suggestions:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSuggestions();
  }, [attemptId]);

  const toggleTopic = (topic: string) => {
    setExpandedTopics(prev => {
      const next = new Set(prev);
      if (next.has(topic)) {
        next.delete(topic);
      } else {
        next.add(topic);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="bg-void-surface rounded-xl border border-void-lighter p-6">
        <div className="flex items-center justify-center gap-3 text-text-muted">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Generating improvement suggestions...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-void-surface rounded-xl border border-void-lighter p-6">
        <div className="flex items-center gap-3 text-red-400">
          <AlertCircle className="w-5 h-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!suggestions) return null;

  // Perfect score
  if (suggestions.type === 'perfect_score') {
    return (
      <div className="bg-green-400/5 rounded-xl border border-green-400/20 p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-green-400/10 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-6 h-6 text-green-400" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-green-400 mb-1">Perfect Score!</h3>
            <p className="text-text-muted">{suggestions.message}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-void-surface rounded-xl border border-void-lighter overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-void-lighter bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Lightbulb className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-medium text-text">Areas for Improvement</h3>
            <p className="text-sm text-text-muted">
              {suggestions.summary || `Focus on ${suggestions.wrong_count} topic${suggestions.wrong_count !== 1 ? 's' : ''} to improve`}
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Weak Areas Tags */}
        {suggestions.weak_areas && suggestions.weak_areas.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-text-muted mb-3 flex items-center gap-2">
              <Target className="w-4 h-4" />
              Topics to Review
            </h4>
            <div className="flex flex-wrap gap-2">
              {suggestions.weak_areas.map((area, i) => (
                <span
                  key={i}
                  className="px-3 py-1.5 bg-amber-500/10 text-amber-400 rounded-full text-sm"
                >
                  {area}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* LLM-Generated Suggestions */}
        {suggestions.type === 'llm_generated' && suggestions.suggestions && (
          <div>
            <h4 className="text-sm font-medium text-text-muted mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Personalized Recommendations
            </h4>
            <div className="space-y-3">
              {suggestions.suggestions.map((suggestion, i) => (
                <SuggestionCard key={i} suggestion={suggestion} />
              ))}
            </div>
          </div>
        )}

        {/* Study Resources */}
        {suggestions.type === 'llm_generated' && suggestions.resources && suggestions.resources.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-text-muted mb-3 flex items-center gap-2">
              <GraduationCap className="w-4 h-4" />
              Study Actions
            </h4>
            <div className="grid gap-2">
              {suggestions.resources.map((resource, i) => (
                <ResourceCard key={i} resource={resource} />
              ))}
            </div>
          </div>
        )}

        {/* Document-Linked Sections */}
        {suggestions.type === 'document_linked' && suggestions.sections && (
          <div>
            <h4 className="text-sm font-medium text-text-muted mb-3 flex items-center gap-2">
              <BookOpen className="w-4 h-4" />
              Relevant Document Sections
            </h4>
            <div className="space-y-2">
              {suggestions.sections.map((section, i) => (
                <TopicDocuments
                  key={i}
                  section={section}
                  isExpanded={expandedTopics.has(section.topic)}
                  onToggle={() => toggleTopic(section.topic)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SuggestionCard({ suggestion }: { suggestion: LLMSuggestion }) {
  const priorityColors = {
    high: 'border-l-red-400 bg-red-400/5',
    medium: 'border-l-yellow-400 bg-yellow-400/5',
    low: 'border-l-blue-400 bg-blue-400/5'
  };

  const priorityLabels = {
    high: { text: 'High Priority', class: 'text-red-400' },
    medium: { text: 'Medium Priority', class: 'text-yellow-400' },
    low: { text: 'Low Priority', class: 'text-blue-400' }
  };

  return (
    <div className={`p-4 rounded-lg border-l-4 ${priorityColors[suggestion.priority]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <h5 className="font-medium text-text mb-1">{suggestion.title}</h5>
          <p className="text-sm text-text-muted">{suggestion.description}</p>
          {suggestion.topics && suggestion.topics.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {suggestion.topics.map((topic, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 bg-void text-text-dim rounded text-xs"
                >
                  {topic}
                </span>
              ))}
            </div>
          )}
        </div>
        <span className={`text-xs ${priorityLabels[suggestion.priority].class}`}>
          {priorityLabels[suggestion.priority].text}
        </span>
      </div>
    </div>
  );
}

function ResourceCard({ resource }: { resource: StudyResource }) {
  const typeIcons = {
    concept: <BookOpen className="w-4 h-4" />,
    practice: <Target className="w-4 h-4" />,
    reference: <FileText className="w-4 h-4" />
  };

  const typeColors = {
    concept: 'text-purple-400 bg-purple-400/10',
    practice: 'text-green-400 bg-green-400/10',
    reference: 'text-blue-400 bg-blue-400/10'
  };

  return (
    <div className="flex items-start gap-3 p-3 bg-void rounded-lg">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${typeColors[resource.type]}`}>
        {typeIcons[resource.type]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h5 className="font-medium text-text text-sm">{resource.title}</h5>
          <span className="text-xs text-text-dim capitalize">{resource.type}</span>
        </div>
        <p className="text-xs text-text-muted mt-0.5">{resource.description}</p>
      </div>
    </div>
  );
}

function TopicDocuments({
  section,
  isExpanded,
  onToggle
}: {
  section: TopicSections;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border border-void-lighter rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-void/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Target className="w-4 h-4 text-amber-400" />
          <span className="font-medium text-text">{section.topic}</span>
          <span className="text-xs text-text-muted">
            ({section.documents.length} section{section.documents.length !== 1 ? 's' : ''})
          </span>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-text-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted" />
        )}
      </button>

      {isExpanded && (
        <div className="border-t border-void-lighter bg-void/30">
          {section.documents.map((doc, i) => (
            <div
              key={i}
              className="px-4 py-3 border-b border-void-lighter last:border-b-0"
            >
              <div className="flex items-start gap-3">
                <FileText className="w-4 h-4 text-text-muted flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-text truncate">
                      {doc.filename}
                    </span>
                    {doc.relevance_score > 0 && (
                      <span className="text-xs text-text-dim">
                        {Math.round(doc.relevance_score * 100)}% match
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted line-clamp-2">
                    {doc.preview}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ImprovementSuggestions;
