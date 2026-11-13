/**
 * F-126: the operations dashboard's shapes, and the words that keep it honest.
 *
 * The dashboard reads the platform's operational records and answers with counters. It does not
 * answer with money and it does not answer with people: a count of how many payments have no
 * outcome is useful to an operations lead and useless to anyone trying to find out about a
 * particular booking.
 *
 * The dashboard is also not complete, and says so. The blueprint lists nine things it should
 * show; the platform can only measure five of them today, and the rest are named here so nobody
 * reads a quiet panel as a healthy platform.
 */

/** The label that says where the numbers come from. */
export const OBSERVABILITY_DISCLOSURE = "Counters from the platform's own operational records";

/** How urgent a signal is. A signal that says money is unaccounted for is critical. */
export const OBSERVABILITY_SEVERITIES = ["critical", "attention", "info"] as const;
export type ObservabilitySeverity = (typeof OBSERVABILITY_SEVERITIES)[number];

export const OBSERVABILITY_SEVERITY_LABEL: Record<ObservabilitySeverity, string> = {
  critical: "Needs a person now",
  attention: "Waiting to be worked through",
  info: "For information",
};

/** One counter from the platform's records. */
export interface ObservabilitySignal {
  signal_key: string;
  signal_label: string;
  value: number;
  detail: string;
  severity: ObservabilitySeverity;
}

/** What Sentry is holding, when this environment can ask it. */
export interface ErrorTrackingSummary {
  unresolved_issues: number;
  capped_at: number;
  window_hours: number;
}

/** Everything the dashboard read, in one answer. */
export interface ObservabilitySnapshot {
  signals: ObservabilitySignal[];
  /** When the platform read its own records. */
  read_at: string;
  disclosure: string;
  /** Null when error tracking is not configured here or could not be read. */
  error_tracking: ErrorTrackingSummary | null;
}

/**
 * What the blueprint asks the dashboard to show and this platform cannot measure yet. Each line
 * names the feature that owns it, so a gap is visible rather than absent.
 */
export const OBSERVABILITY_NOT_MEASURED: readonly string[] = [
  "Update latency — nothing in the platform records how long an update took.",
  "Retry exhaustion — F-73 (Real-time Job Monitoring & Alerting) has no job records yet.",
  "Verification SLA — F-53 (Vendor Verification Review Queue) has no review queue yet.",
  "Scanner conflicts — F-62 (Upload Moderation & Takedown) is not built.",
  "Deletion backlog — F-58 (GDPR/UK-GDPR Data Rights) is not built.",
  "On-call alerts — F-73 owns alert delivery, and the blueprint calls it a launch requirement.",
];

/** The signals that are not only for information: the ones an operations lead works through. */
export function signalsNeedingAttention(signals: ObservabilitySignal[]): ObservabilitySignal[] {
  return signals.filter((signal) => signal.severity !== "info");
}

/** The critical signals first, then the ones to work through, then the rest. */
export function bySeverity(signals: ObservabilitySignal[]): ObservabilitySignal[] {
  const rank: Record<ObservabilitySeverity, number> = { critical: 0, attention: 1, info: 2 };
  return [...signals].sort((left, right) => rank[left.severity] - rank[right.severity]);
}

/** The count to show: a number, and whether it is a number worth looking at. */
export function signalValueLabel(signal: ObservabilitySignal): string {
  if (signal.value === 0) return "None";
  return String(signal.value);
}
