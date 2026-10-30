// Types for scripts/changelog.mjs (imported by apps/web/vite.config.ts).
export interface ChangelogGroup {
  title: string;
  items: string[];
}
export interface ChangelogRelease {
  version: string;
  date: string | null;
  unreleased: boolean;
  summary: string;
  groups: ChangelogGroup[];
}
export const CHANGELOG: string;
export const GROUPS: string[];
export function parseChangelog(text: string): ChangelogRelease[];
export function readChangelog(path?: string): ChangelogRelease[];
export function findRelease(releases: ChangelogRelease[], version: string): ChangelogRelease | null;
export function releaseMarkdown(r: ChangelogRelease): string;
export function cutRelease(text: string, version: string, date: string): string;
