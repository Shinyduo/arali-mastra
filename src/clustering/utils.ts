/**
 * Vector math utilities for clustering.
 * Port of arali-python/app/core/utils.py
 */

/** L2-normalize a vector. Returns the original if zero-length. */
export function normalize(vector: number[]): number[] {
  let norm = 0;
  for (let i = 0; i < vector.length; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return vector;
  const result = new Array<number>(vector.length);
  for (let i = 0; i < vector.length; i++) {
    result[i] = vector[i] / norm;
  }
  return result;
}

/** Cosine similarity between two vectors. Returns 0 if either is zero-length. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/** Compute the normalized mean of a set of vectors. */
export function normalizedMean(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      sum[i] += vec[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    sum[i] /= vectors.length;
  }
  return normalize(sum);
}

/**
 * Incrementally update a centroid with new vectors.
 * Returns [newCentroid, newSize].
 */
export function incrementalCentroid(
  centroid: number[],
  size: number,
  newVectors: number[][],
): [number[], number] {
  if (newVectors.length === 0) return [centroid, size];

  const dim = centroid.length;
  const total = new Array<number>(dim);

  // old_centroid * size
  for (let i = 0; i < dim; i++) {
    total[i] = centroid[i] * size;
  }

  // + sum(new_vectors)
  for (const vec of newVectors) {
    for (let i = 0; i < dim; i++) {
      total[i] += vec[i];
    }
  }

  const newSize = size + newVectors.length;
  for (let i = 0; i < dim; i++) {
    total[i] /= newSize;
  }

  return [normalize(total), newSize];
}

// ---------------------------------------------------------------------------
// pgvector ↔ number[] conversion
// ---------------------------------------------------------------------------

/** Parse a pgvector value from the database into a number array. */
export function vectorFromDb(value: unknown): number[] | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const cleaned = value.replace(/^\[/, "").replace(/\]$/, "").trim();
    if (!cleaned) return [];
    return cleaned.split(",").map(Number);
  }
  if (Array.isArray(value)) return value.map(Number);
  return null;
}

/** Stringify a number array for pgvector storage. */
export function vectorToDb(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

// ---------------------------------------------------------------------------
// Feature text extraction
// ---------------------------------------------------------------------------

/**
 * Extract a concise text string from insight details_json for embedding.
 * Priority: competitor_name > objection > feature_title > feature_summary
 */
export function buildFeatureText(
  details: Record<string, unknown> | string | null,
): string {
  let data: Record<string, unknown>;
  if (typeof details === "string") {
    try {
      data = JSON.parse(details) as Record<string, unknown>;
    } catch {
      data = {};
    }
  } else {
    data = details ?? {};
  }

  // Competitor name
  const competitorName = String(data.competitor_name ?? "").trim();
  if (competitorName) return competitorName;

  // Objection
  const objectionCategory = String(data.objection_category ?? "").trim();
  let evidence = String(data.evidence ?? "").trim();
  // Strip timestamp prefix like "[00:09:43] "
  if (evidence.length > 10) {
    evidence = evidence.slice(10).trim();
  }
  if (objectionCategory && evidence) return `${objectionCategory}: ${evidence}`;
  if (objectionCategory) return objectionCategory;
  if (evidence) return evidence;

  // Feature fields — title only (summary too detailed for clustering)
  const title = String(data.feature_title ?? "").trim();
  const summary = String(data.feature_summary ?? "").trim();
  if (title) return title;
  return summary;
}

/** Check if a similarity score meets the assignment threshold. */
export function shouldAssignCluster(_size: number, sim: number): boolean {
  return sim >= 0.72;
}

/** Create a zero vector of the given dimension. */
export function zeroVector(dim: number): number[] {
  return new Array<number>(dim).fill(0);
}
