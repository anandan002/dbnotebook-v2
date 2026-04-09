/**
 * Dashboard View Component
 *
 * Main dashboard container with tabs for:
 * - Dashboard (KPIs and Charts)
 * - Data Profile (ydata-profiling HTML report)
 *
 * Includes AI Dashboard Assistant for NLP-based modifications.
 */

import { useState, useCallback } from 'react';
import { LayoutDashboard, FileText, Download, RefreshCw, ExternalLink, Table2 } from 'lucide-react';
import { useAnalytics } from '../../contexts/AnalyticsContext';
import { FilterBar } from './FilterBar';
import { KPICardGrid } from './KPICardGrid';
import { ChartGrid } from './ChartGrid';
import { ColumnProfileTable } from './ColumnProfileTable';
import { DashboardModifier } from './DashboardModifier';
import { FilteredDataTable } from './FilteredDataTable';
import { withBasePath } from '../../utils/paths';

type TabType = 'dashboard' | 'profile';

interface DashboardViewProps {
  className?: string;
}

export function DashboardView({ className = '' }: DashboardViewProps) {
  const {
    dashboardConfig,
    profilingResult,
    sessionId,
    parsedData,
    analysisState,
    resetDashboard,
    // NLP Modification
    modificationState,
    isModifying,
    modifyDashboard,
    undoModification,
    redoModification,
  } = useAnalytics();

  const [activeTab, setActiveTab] = useState<TabType>('dashboard');

  const handleExport = useCallback(() => {
    // Export dashboard as PDF using browser print
    // Add print class to body to apply print styles
    document.body.classList.add('printing-dashboard');

    // Trigger print dialog (user can save as PDF)
    setTimeout(() => {
      window.print();
      // Remove print class after print dialog closes
      document.body.classList.remove('printing-dashboard');
    }, 100);
  }, []);

  const handleOpenProfile = useCallback(() => {
    if (sessionId && profilingResult?.htmlReportUrl) {
      window.open(withBasePath(`/api/analytics/profile/${sessionId}/html`), '_blank');
    }
  }, [sessionId, profilingResult]);

  if (analysisState !== 'complete') {
    return null;
  }

  const metadata = dashboardConfig?.metadata;
  const rowCount = parsedData?.rowCount || 0;
  const columnCount = parsedData?.columnCount || 0;

  return (
    <div className={`dashboard-view ${className}`}>
      {/* Header */}
      <div className="dashboard-view__header">
        <div className="dashboard-view__title-section">
          <h1 className="dashboard-view__title">
            {metadata?.title || 'Analytics Dashboard'}
          </h1>
          {metadata?.description && (
            <p className="dashboard-view__description">{metadata.description}</p>
          )}
          <div className="dashboard-view__stats">
            <span>{rowCount.toLocaleString()} rows</span>
            <span>{columnCount} columns</span>
            {profilingResult?.qualityScore !== undefined && (
              <span className="dashboard-view__quality">
                Quality: {profilingResult.qualityScore.toFixed(1)}/10
              </span>
            )}
          </div>
        </div>

        <div className="dashboard-view__actions">
          <button
            onClick={handleExport}
            className="dashboard-view__action-btn"
            title="Export dashboard"
          >
            <Download size={18} />
            <span>Export</span>
          </button>
          <button
            onClick={resetDashboard}
            className="dashboard-view__action-btn dashboard-view__action-btn--secondary"
            title="Analyze a different file"
          >
            <RefreshCw size={18} />
            <span>New Analysis</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="dashboard-view__tabs">
        <button
          className={`dashboard-view__tab ${activeTab === 'dashboard' ? 'dashboard-view__tab--active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          <LayoutDashboard size={16} />
          <span>Dashboard</span>
        </button>
        <button
          className={`dashboard-view__tab ${activeTab === 'profile' ? 'dashboard-view__tab--active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          <FileText size={16} />
          <span>Data Profile</span>
        </button>
      </div>

      {/* Tab Content */}
      <div className="dashboard-view__content">
        {activeTab === 'dashboard' && (
          <div className="dashboard-view__dashboard">
            {/* AI Dashboard Modifier */}
            <DashboardModifier
              onModify={modifyDashboard}
              onUndo={undoModification}
              onRedo={redoModification}
              canUndo={modificationState.canUndo}
              canRedo={modificationState.canRedo}
              isLoading={isModifying}
              lastChanges={modificationState.lastChanges}
              className="dashboard-view__modifier"
            />

            {/* Filters */}
            <FilterBar className="dashboard-view__filters" />

            {/* KPIs */}
            <section className="dashboard-view__section">
              <h2 className="dashboard-view__section-title">Key Metrics</h2>
              <KPICardGrid />
            </section>

            {/* Charts */}
            <section className="dashboard-view__section">
              <h2 className="dashboard-view__section-title">Visualizations</h2>
              <ChartGrid />
            </section>

            {/* Filtered Data Table */}
            <section className="dashboard-view__section">
              <FilteredDataTable maxRows={100} />
            </section>

            {/* AI Recommendation */}
            {metadata?.recommendationReason && (
              <div className="dashboard-view__recommendation">
                <h3>AI Recommendation</h3>
                <p>{metadata.recommendationReason}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="dashboard-view__profile">
            <div className="dashboard-view__profile-header">
              <h2>Data Profiling Report</h2>
              {profilingResult?.htmlReportUrl && (
                <button
                  onClick={handleOpenProfile}
                  className="dashboard-view__profile-link"
                >
                  <ExternalLink size={16} />
                  <span>Open Full Report</span>
                </button>
              )}
            </div>

            {/* Profile Summary */}
            <div className="dashboard-view__profile-summary">
              <div className="profile-stat">
                <span className="profile-stat__label">Rows</span>
                <span className="profile-stat__value">
                  {profilingResult?.overview?.rowCount?.toLocaleString() || 'N/A'}
                </span>
              </div>
              <div className="profile-stat">
                <span className="profile-stat__label">Columns</span>
                <span className="profile-stat__value">
                  {profilingResult?.overview?.columnCount || 'N/A'}
                </span>
              </div>
              <div className="profile-stat">
                <span className="profile-stat__label">Missing</span>
                <span className="profile-stat__value">
                  {profilingResult?.overview?.missingCellsPercent?.toFixed(1) || '0'}%
                </span>
              </div>
              <div className="profile-stat">
                <span className="profile-stat__label">Duplicates</span>
                <span className="profile-stat__value">
                  {profilingResult?.overview?.duplicateRowsPercent?.toFixed(1) || '0'}%
                </span>
              </div>
            </div>

            {/* Column Profile Table */}
            {profilingResult?.columns && profilingResult.columns.length > 0 && (
              <div className="dashboard-view__column-profile">
                <h3>
                  <Table2 size={18} />
                  <span>Column Statistics</span>
                </h3>
                <ColumnProfileTable columns={profilingResult.columns} />
              </div>
            )}

            {/* Quality Alerts */}
            {profilingResult?.qualityAlerts && profilingResult.qualityAlerts.length > 0 && (
              <div className="dashboard-view__alerts">
                <h3>Data Quality Alerts</h3>
                <ul className="alert-list">
                  {profilingResult.qualityAlerts.slice(0, 10).map((alert, i) => (
                    <li
                      key={i}
                      className={`alert-list__item alert-list__item--${alert.severity}`}
                    >
                      <span className="alert-list__column">{alert.column || 'Dataset'}</span>
                      <span className="alert-list__message">{alert.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Correlations */}
            {profilingResult?.correlations && profilingResult.correlations.length > 0 && (
              <div className="dashboard-view__correlations">
                <h3>High Correlations</h3>
                <ul className="correlation-list">
                  {profilingResult.correlations.slice(0, 10).map((corr, i) => (
                    <li key={i} className="correlation-list__item">
                      <span>{corr.var1}</span>
                      <span className="correlation-list__arrow">↔</span>
                      <span>{corr.var2}</span>
                      <span className={`correlation-list__value ${corr.correlation > 0 ? 'positive' : 'negative'}`}>
                        {corr.correlation.toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Iframe for full report */}
            {profilingResult?.htmlReportUrl && sessionId && (
              <div className="dashboard-view__profile-iframe">
                <iframe
                  src={withBasePath(`/api/analytics/profile/${sessionId}/html`)}
                  title="Data Profile Report"
                  className="profile-iframe"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default DashboardView;
