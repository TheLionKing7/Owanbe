/**
 * Server-only: the observability tool's own numbers.
 *
 * The blueprint chooses Sentry as the platform's observability tool (blueprint/tech-spec.md
 * ADR-14), and the browser already reports scrubbed errors to it through
 * `src/lib/monitoring/browser.ts`. What is missing is the other half: a way to ask Sentry how
 * many errors it is holding, so the operations dashboard can show them beside the platform's own
 * counters.
 *
 * Three rules this file owns:
 *   * the auth token is server-only and never leaves this file. It is not logged, not returned
 *     and not put in a URL.
 *   * a failure to reach Sentry is not a failure of the dashboard. The dashboard shows the
 *     platform's counters either way, and says that error tracking was not available.
 *   * the count is honest about its cap: Sentry pages its issue list, so the summary says how
 *     many issues were counted and the most it could count.
 */

export interface SentryIssueSummary {
  /** The issues Sentry returned for the window. */
  unresolved_issues: number;
  /** The most this client will ask for: Sentry caps a page at 100. */
  capped_at: number;
  /** The window the count covers, in hours. */
  window_hours: number;
}

/** The most issues one request asks for. */
export const SENTRY_ISSUE_LIMIT = 100;

/** The window the dashboard counts errors over. */
export const SENTRY_WINDOW_HOURS = 24;

/** Whether this environment can talk to Sentry's management API at all. */
export function sentryConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(
    env["SENTRY_AUTH_TOKEN"]?.trim() && env["SENTRY_ORG"]?.trim() && env["SENTRY_PROJECT"]?.trim(),
  );
}

/**
 * The unresolved issues Sentry last saw inside the window, or null when there is no Sentry to ask
 * or the answer could not be read. A null is never an error: the dashboard says so plainly.
 */
export async function readSentryIssueSummary(
  env: Record<string, string | undefined> = process.env,
): Promise<SentryIssueSummary | null> {
  const token = env["SENTRY_AUTH_TOKEN"]?.trim();
  const org = env["SENTRY_ORG"]?.trim();
  const project = env["SENTRY_PROJECT"]?.trim();
  if (!token || !org || !project) return null;

  // The issues last seen inside the window, and only those.
  const query = encodeURIComponent(`is:unresolved lastSeen:-${SENTRY_WINDOW_HOURS}h`);
  const url =
    `https://sentry.io/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}` +
    `/issues/?query=${query}&limit=${SENTRY_ISSUE_LIMIT}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  } catch {
    return null;
  }
  if (!res.ok) {
    // The status is safe to keep: the token is not in it and the URL is not logged.
    console.error("sentry issue summary failed", res.status);
    return null;
  }

  const body = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(body)) return null;

  return {
    unresolved_issues: body.length,
    capped_at: SENTRY_ISSUE_LIMIT,
    window_hours: SENTRY_WINDOW_HOURS,
  };
}
