/**
 * Vector math utilities for clustering.
 * Port of arali-python/app/core/utils.py
 *
 * Uses Float32Array for memory efficiency — 3072 floats = 12KB per vector
 * vs ~50-100KB with plain number[] arrays (V8 tagged pointer overhead).
 */

/** Numeric array type — accepts TypedArrays and plain number[]. */
export type Vec = Float32Array | Float64Array | number[];

/** L2-normalize a vector. Returns a new Float32Array. */
export function normalize(vector: Vec): number[] {
  let norm = 0;
  for (let i = 0; i < vector.length; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return Array.from(vector);
  const result = new Array<number>(vector.length);
  for (let i = 0; i < vector.length; i++) {
    result[i] = vector[i] / norm;
  }
  return result;
}

/** Cosine similarity between two vectors. Returns 0 if either is zero-length. */
export function cosineSimilarity(a: Vec, b: Vec): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/** Compute the normalized mean of a set of vectors. */
export function normalizedMean(vectors: Vec[]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const sum = new Float64Array(dim); // use f64 for accumulation precision
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
  centroid: Vec,
  size: number,
  newVectors: Vec[],
): [number[], number] {
  if (newVectors.length === 0) return [Array.from(centroid), size];

  const dim = centroid.length;
  const total = new Float64Array(dim);

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
// pgvector ↔ array conversion
// ---------------------------------------------------------------------------

/**
 * Parse a pgvector value from the database into a Float32Array.
 * Uses Float32Array for ~6x less memory than number[].
 */
export function vectorFromDb(value: unknown): number[] | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const cleaned = value.replace(/^\[/, "").replace(/\]$/, "").trim();
    if (!cleaned) return [];
    const parts = cleaned.split(",");
    const arr = new Float32Array(parts.length);
    for (let i = 0; i < parts.length; i++) {
      arr[i] = Number(parts[i]);
    }
    return Array.from(arr); // convert back to number[] for compatibility
  }
  if (Array.isArray(value)) return value.map(Number);
  return null;
}

/** Stringify a number array for pgvector storage. */
export function vectorToDb(vector: Vec): string {
  return `[${Array.from(vector).join(",")}]`;
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
