import React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Loader2, Maximize2, Minimize2, X } from "lucide-react";

export type ClipExportRowStatus = "pending" | "active" | "done" | "error" | "cancelled";

export type ClipExportRow = {
  id: string;
  label: string;
  range: string;
  status: ClipExportRowStatus;
  errorMessage?: string;
};

export type ClipExportPhase = "running" | "complete" | "error" | "cancelled";

export type ClipExportSession = {
  mode: "single" | "merge";
  rows: ClipExportRow[];
  activeIndex: number;
  activePercent: number;
  activeFps: string | null;
  activeSpeed: string | null;
  activeMessage: string | null;
  phase: ClipExportPhase;
  outputDir: string;
};

function overallPercent(session: ClipExportSession): number {
  if (session.rows.length === 0) return 0;
  if (session.phase === "complete") return 100;
  let done = 0;
  for (const row of session.rows) {
    if (row.status === "done") done += 1;
  }
  const activeContribution = session.activePercent / 100;
  const totalUnits = session.rows.length;
  const completedUnits = done + (session.rows[session.activeIndex]?.status === "active" ? activeContribution : 0);
  return Math.max(0, Math.min(100, (completedUnits / totalUnits) * 100));
}

function statusIcon(status: ClipExportRowStatus) {
  if (status === "done") return <Check size={13} strokeWidth={2.6} />;
  if (status === "active") return <Loader2 className="is-spinning" size={13} strokeWidth={2.4} />;
  if (status === "error") return <AlertTriangle size={13} strokeWidth={2.4} />;
  if (status === "cancelled") return <X size={12} strokeWidth={2.6} />;
  return <span className="clip-export-row-dot" aria-hidden="true" />;
}

export function ClipExportProgressModal({
  session,
  minimized,
  onCancel,
  onClose,
  onMinimize,
  onRestore,
}: {
  session: ClipExportSession | null;
  minimized: boolean;
  onCancel: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
}) {
  React.useEffect(() => {
    if (!session) return undefined;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && session.phase !== "running") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [session, onClose]);

  if (!session) return null;

  const overall = overallPercent(session);
  const total = session.rows.length;
  const doneCount = session.rows.filter((r) => r.status === "done").length;
  const errorCount = session.rows.filter((r) => r.status === "error").length;
  const activeRow = session.rows[session.activeIndex] ?? null;

  const isRunning = session.phase === "running";
  const headerKicker = session.mode === "merge" ? "Merging clips" : "Exporting clips";
  const headerTitle = (() => {
    if (session.phase === "complete") {
      return session.mode === "merge"
        ? "Merge complete"
        : `Exported ${doneCount} of ${total} clips`;
    }
    if (session.phase === "cancelled") {
      return "Export cancelled";
    }
    if (session.phase === "error") {
      return "Export failed";
    }
    return session.mode === "merge"
      ? "Merging clips"
      : `Exporting clip ${Math.min(session.activeIndex + 1, total)} of ${total}`;
  })();

  if (minimized) {
    return createPortal(
      <ClipExportPill
        session={session}
        overall={overall}
        doneCount={doneCount}
        errorCount={errorCount}
        total={total}
        headerKicker={headerKicker}
        headerTitle={headerTitle}
        isRunning={isRunning}
        onCancel={onCancel}
        onClose={onClose}
        onRestore={onRestore}
      />,
      document.body,
    );
  }

  return createPortal(
    <div
      className="episode-label-backdrop clip-export-backdrop"
      role="dialog"
      aria-label="Export progress"
      onClick={(event) => {
        if (!isRunning && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="episode-label-modal clip-export-modal">
        <div className="episode-label-header">
          <div>
            <span className="episode-label-kicker">{headerKicker}</span>
            <h2>{headerTitle}</h2>
            <p>{session.outputDir}</p>
          </div>
          <div className="clip-export-header-actions">
            <button
              type="button"
              className="episode-label-close"
              onClick={onMinimize}
              aria-label="Minimize"
              title="Minimize"
            >
              <Minimize2 size={14} />
            </button>
            {!isRunning && (
              <button
                type="button"
                className="episode-label-close"
                onClick={onClose}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="clip-export-overall">
          <div className="clip-export-overall-line">
            <strong>Overall</strong>
            <span>
              {doneCount}/{total}
              {errorCount > 0 ? ` · ${errorCount} failed` : ""}
              {" · "}
              {Math.round(overall)}%
            </span>
          </div>
          <div className={`clip-progress-track ${isRunning && overall <= 0 ? "is-indeterminate" : ""}`}>
            <span className="spring-motion" style={{ width: `${overall}%` }} />
          </div>
        </div>

        {activeRow && isRunning && (
          <div className="clip-export-active">
            <div className="clip-export-active-line">
              <strong>{activeRow.label}</strong>
              <span>
                {Math.round(session.activePercent)}%
                {session.activeFps ? ` · ${session.activeFps} fps` : ""}
                {session.activeSpeed ? ` · ${session.activeSpeed}` : ""}
              </span>
            </div>
            <div className={`clip-progress-track ${session.activePercent <= 0 ? "is-indeterminate" : ""}`}>
              <span className="spring-motion" style={{ width: `${session.activePercent}%` }} />
            </div>
            {session.activeMessage && (
              <p className="clip-export-active-message">{session.activeMessage}</p>
            )}
          </div>
        )}

        <ul className="clip-export-rows" aria-label="Per-clip status">
          {session.rows.map((row, index) => (
            <li
              key={row.id}
              className={`clip-export-row is-${row.status} ${index === session.activeIndex && isRunning ? "is-current" : ""}`}
            >
              <span className={`clip-export-row-icon is-${row.status}`}>{statusIcon(row.status)}</span>
              <span className="clip-export-row-label" title={row.label}>{row.label}</span>
              <span className="clip-export-row-range">{row.range}</span>
              {row.status === "error" && row.errorMessage && (
                <span className="clip-export-row-error" title={row.errorMessage}>
                  {row.errorMessage}
                </span>
              )}
            </li>
          ))}
        </ul>

        <div className="episode-label-actions">
          <div className="episode-label-actions-right">
            {isRunning ? (
              <button
                type="button"
                className="clip-export-cancel"
                onClick={onCancel}
              >
                <X size={14} strokeWidth={2.4} />
                Cancel export
              </button>
            ) : (
              <button type="button" className="episode-label-confirm" onClick={onClose}>
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ClipExportPill({
  session,
  overall,
  doneCount,
  errorCount,
  total,
  headerKicker,
  headerTitle,
  isRunning,
  onCancel,
  onClose,
  onRestore,
}: {
  session: ClipExportSession;
  overall: number;
  doneCount: number;
  errorCount: number;
  total: number;
  headerKicker: string;
  headerTitle: string;
  isRunning: boolean;
  onCancel: () => void;
  onClose: () => void;
  onRestore: () => void;
}) {
  // After the modal subtree unmounts on minimize, focus falls to document.body
  // and Tab restarts from the top. Pull focus into the pill so keyboard users
  // stay in context.
  const bodyRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    bodyRef.current?.focus();
  }, []);
  return (
    <div
      className={`clip-export-pill is-${session.phase}`}
      role="status"
      aria-label={`${headerKicker}: ${headerTitle}`}
    >
      <button
        ref={bodyRef}
        type="button"
        className="clip-export-pill-body"
        onClick={onRestore}
        title="Expand"
        aria-label="Expand export progress"
      >
        <div className="clip-export-pill-head">
          <span className="clip-export-pill-kicker">{headerKicker}</span>
          <span className="clip-export-pill-count">
            {doneCount}/{total}
            {errorCount > 0 ? ` · ${errorCount} failed` : ""}
            {" · "}
            {Math.round(overall)}%
          </span>
        </div>
        <div className={`clip-progress-track ${isRunning && overall <= 0 ? "is-indeterminate" : ""}`}>
          <span className="spring-motion" style={{ width: `${overall}%` }} />
        </div>
      </button>
      <div className="clip-export-pill-actions">
        <button
          type="button"
          className="clip-export-pill-btn"
          onClick={onRestore}
          aria-label="Expand"
          title="Expand"
        >
          <Maximize2 size={13} strokeWidth={2.4} />
        </button>
        {isRunning ? (
          <button
            type="button"
            className="clip-export-pill-btn is-cancel"
            onClick={onCancel}
            aria-label="Cancel export"
            title="Cancel export"
          >
            <X size={14} strokeWidth={2.6} />
          </button>
        ) : (
          <button
            type="button"
            className="clip-export-pill-btn"
            onClick={onClose}
            aria-label="Dismiss"
            title="Dismiss"
          >
            <X size={14} strokeWidth={2.6} />
          </button>
        )}
      </div>
    </div>
  );
}
