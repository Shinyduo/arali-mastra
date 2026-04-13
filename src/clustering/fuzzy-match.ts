/**
 * Fuzzy matching utilities for competitor name clustering.
 * Port of arali-python/app/core/fuzzy_match.py
 *
 * Replaces RapidFuzz with fastest-levenshtein for token-sort-ratio.
 */

import { distance as levenshteinDistance } from "fastest-levenshtein";

const NUMBER_MAP: Record<string, string> = {
  three: "3",
  two: "2",
  one: "1",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
};

const COMPANY_SUFFIXES = [
  "inc.",
  "inc",
  "llc",
  "llc.",
  "ltd",
  "ltd.",
  "corporation",
  "corp.",
  "corp",
  "limited",
  "co.",
  "co",
  "ai",
  "app",
  "pro",
];

/**
 * Normalize a competitor name for better matching.
 * - Lowercase, strip whitespace
 * - Convert number words to digits
 * - Split numbers from text ("3D" → "3 D")
 * - Remove common company suffixes
 */
export function normalizeCompetitorName(name: string): string {
  let n = name.trim().toLowerCase();

  // Convert number words to digits
  for (const [word, digit] of Object.entries(NUMBER_MAP)) {
    n = n.replaceAll(word, digit);
  }

  // Remove special characters
  n = n.replace(/[-_.]/g, " ");

  // Split numbers from text ("3d" → "3 d", "v2" → "v 2")
  let final = "";
  for (const ch of n) {
    if (ch >= "0" && ch <= "9") {
      final += ` ${ch} `;
    } else {
      final += ch;
    }
  }
  n = final.split(/\s+/).filter(Boolean).join(" ");

  // Remove trailing company suffixes
  for (const suffix of COMPANY_SUFFIXES) {
    if (n.endsWith(` ${suffix}`)) {
      n = n.slice(0, -(suffix.length + 1)).trim();
    }
  }

  // Remove standalone suffixes
  n = n
    .split(" ")
    .filter((w) => !COMPANY_SUFFIXES.includes(w))
    .join(" ");

  return n;
}

/**
 * Token-sort ratio: tokenize both strings, sort tokens, compute Levenshtein ratio.
 * Returns a score between 0 and 1, where 1 is a perfect match.
 */
export function tokenSortRatio(a: string, b: string): number {
  const sortedA = a.split(/\s+/).sort().join(" ");
  const sortedB = b.split(/\s+/).sort().join(" ");

  const maxLen = Math.max(sortedA.length, sortedB.length);
  if (maxLen === 0) return 1; // both empty

  const dist = levenshteinDistance(sortedA, sortedB);
  return 1 - dist / maxLen;
}

/**
 * Calculate fuzzy match score between two competitor names.
 * Normalizes both names then computes token-sort ratio.
 */
export function fuzzyMatchScore(name1: string, name2: string): number {
  const norm1 = normalizeCompetitorName(name1);
  const norm2 = normalizeCompetitorName(name2);
  return tokenSortRatio(norm1, norm2);
}

/**
 * Find the best matching competitor name from a list of candidates.
 * Returns [bestMatch, score] or [null, 0] if no match above threshold.
 */
export function findBestMatch(
  query: string,
  candidates: string[],
  threshold = 0.85,
): [string | null, number] {
  if (candidates.length === 0) return [null, 0];

  const normQuery = normalizeCompetitorName(query);

  let bestScore = 0;
  let bestIdx = -1;

  for (let i = 0; i < candidates.length; i++) {
    const normCandidate = normalizeCompetitorName(candidates[i]);
    const score = tokenSortRatio(normQuery, normCandidate);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestScore >= threshold && bestIdx >= 0) {
    return [candidates[bestIdx], bestScore];
  }

  return [null, bestScore];
}

/**
 * Cluster competitor names by fuzzy matching.
 * Returns a map of canonical name → list of variant names.
 */
export function clusterByFuzzyMatch(
  names: string[],
  threshold = 0.85,
): Map<string, string[]> {
  const clusters = new Map<string, string[]>();
  if (names.length === 0) return clusters;

  const processed = new Set<string>();

  for (const name of names) {
    if (processed.has(name)) continue;

    // Start a new cluster with this name as canonical
    const members = [name];
    processed.add(name);

    // Find all similar names
    for (const other of names) {
      if (processed.has(other)) continue;
      const score = fuzzyMatchScore(name, other);
      if (score >= threshold) {
        members.push(other);
        processed.add(other);
      }
    }

    clusters.set(name, members);
  }

  return clusters;
}
