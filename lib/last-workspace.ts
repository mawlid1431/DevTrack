/**
 * Remembers the workspace (org slug) the user last opened in this browser,
 * so signing in again lands them back on their own data.
 */
const KEY = "devtrack:last-workspace";

export function readLastWorkspace(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeLastWorkspace(slug: string): void {
  try {
    localStorage.setItem(KEY, slug);
  } catch {
    // Storage blocked: the onboarding page falls back to other rules.
  }
}
