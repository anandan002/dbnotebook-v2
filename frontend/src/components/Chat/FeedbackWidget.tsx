/**
 * FeedbackWidget — inline feedback UI attached to assistant messages.
 *
 * Flow:
 *   1. Thumbs up / thumbs down buttons (always visible, one click to submit)
 *   2. After thumbs selection → expand panel with star rating, category chips, optional note
 *   3. Submit → POST /api/v2/chat/feedback → show confirmation
 *
 * Only rendered when `traceId` and `queryId` are present (tracing enabled).
 */

import { memo, useState, useCallback } from 'react';
import { ThumbsUp, ThumbsDown, Star, X, Send, Check } from 'lucide-react';
import { submitFeedback, type FeedbackCategory } from '../../services/api';

interface FeedbackWidgetProps {
  traceId: string;
  queryId: string;
  notebookId: string;
}

type SubmitState = 'idle' | 'submitting' | 'submitted' | 'error';

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'helpful', label: 'Helpful' },
  { value: 'inaccurate', label: 'Inaccurate' },
  { value: 'irrelevant', label: 'Irrelevant' },
  { value: 'incomplete', label: 'Incomplete' },
  { value: 'other', label: 'Other' },
];

export const FeedbackWidget = memo(function FeedbackWidget({
  traceId,
  queryId,
  notebookId,
}: FeedbackWidgetProps) {
  const [helpful, setHelpful] = useState<boolean | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [userMessage, setUserMessage] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleThumbsClick = useCallback((value: boolean) => {
    if (submitState === 'submitted') return;
    setHelpful(value);
    setExpanded(true);
  }, [submitState]);

  const handleSubmit = useCallback(async () => {
    if (submitState !== 'idle') return;
    if (helpful === null && rating === null) {
      setErrorMessage('Please select a rating or helpful indicator.');
      return;
    }

    setSubmitState('submitting');
    setErrorMessage('');

    try {
      await submitFeedback({
        trace_id: traceId,
        query_id: queryId,
        notebook_id: notebookId,
        helpful: helpful ?? undefined,
        rating: rating ?? undefined,
        feedback_category: category ?? undefined,
        user_message: userMessage.trim() || undefined,
      });
      setSubmitState('submitted');
    } catch (err) {
      console.error('[FeedbackWidget] Failed to submit feedback:', err);
      setSubmitState('error');
      setErrorMessage('Could not save feedback. Please try again.');
    }
  }, [submitState, helpful, rating, traceId, queryId, notebookId, category, userMessage]);

  const handleDismiss = useCallback(() => {
    setExpanded(false);
    if (submitState !== 'submitted') {
      setHelpful(null);
    }
  }, [submitState]);

  // Submitted confirmation — compact
  if (submitState === 'submitted') {
    return (
      <div className="flex items-center gap-1.5 mt-3 text-xs text-success">
        <Check className="w-3.5 h-3.5" />
        <span>Thanks for your feedback</span>
      </div>
    );
  }

  return (
    <div className="mt-3">
      {/* Thumbs row — always visible */}
      <div className="flex items-center gap-1">
        <span className="text-xs text-text-dim mr-1">Helpful?</span>
        <button
          onClick={() => handleThumbsClick(true)}
          disabled={submitState === 'submitting'}
          title="Thumbs up"
          aria-label="Mark as helpful"
          className={`
            p-1.5 rounded-lg transition-all duration-150
            ${helpful === true
              ? 'bg-success/20 text-success'
              : 'text-text-dim hover:text-success hover:bg-success/10'
            }
          `}
        >
          <ThumbsUp className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => handleThumbsClick(false)}
          disabled={submitState === 'submitting'}
          title="Thumbs down"
          aria-label="Mark as not helpful"
          className={`
            p-1.5 rounded-lg transition-all duration-150
            ${helpful === false
              ? 'bg-error/20 text-error'
              : 'text-text-dim hover:text-error hover:bg-error/10'
            }
          `}
        >
          <ThumbsDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="mt-2 p-3 rounded-lg bg-void-surface border border-void-lighter space-y-3 animate-[slide-up_0.2s_ease-out]">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted">Share more details (optional)</span>
            <button
              onClick={handleDismiss}
              className="p-0.5 rounded text-text-dim hover:text-text transition-colors"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Star rating */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-text-dim mr-1">Rating:</span>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => setRating(star === rating ? null : star)}
                onMouseEnter={() => setHoverRating(star)}
                onMouseLeave={() => setHoverRating(null)}
                title={`${star} star${star !== 1 ? 's' : ''}`}
                className="p-0.5 transition-colors"
              >
                <Star
                  className={`w-4 h-4 transition-colors ${
                    star <= (hoverRating ?? rating ?? 0)
                      ? 'fill-warning text-warning'
                      : 'fill-transparent text-text-dim'
                  }`}
                />
              </button>
            ))}
          </div>

          {/* Category chips */}
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setCategory(category === value ? null : value)}
                className={`
                  px-2 py-0.5 rounded-full text-xs border transition-all duration-150
                  ${category === value
                    ? 'bg-glow/20 text-glow border-glow/40'
                    : 'text-text-dim border-void-lighter hover:text-text hover:border-text-dim'
                  }
                `}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Note textarea */}
          <textarea
            value={userMessage}
            onChange={(e) => setUserMessage(e.target.value)}
            placeholder="Additional comments… (optional)"
            maxLength={500}
            rows={2}
            className="
              w-full px-2.5 py-1.5 rounded-lg text-xs
              bg-void border border-void-lighter
              text-text placeholder:text-text-dim
              focus:outline-none focus:border-glow/40
              resize-none transition-colors
            "
          />

          {/* Error message */}
          {errorMessage && (
            <p className="text-xs text-error">{errorMessage}</p>
          )}

          {/* Submit button */}
          <div className="flex justify-end">
            <button
              onClick={handleSubmit}
              disabled={submitState === 'submitting' || (helpful === null && rating === null)}
              className="
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                bg-glow/20 text-glow border border-glow/30
                hover:bg-glow/30 transition-all duration-150
                disabled:opacity-40 disabled:cursor-not-allowed
              "
            >
              {submitState === 'submitting' ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-glow border-t-transparent animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  Submit Feedback
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default FeedbackWidget;
