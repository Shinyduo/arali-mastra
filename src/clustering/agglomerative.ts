/**
 * Agglomerative (hierarchical) clustering with cosine distance and average linkage.
 * Replaces scikit-learn's AgglomerativeClustering used in arali-python.
 *
 * Algorithm:
 *   1. Each vector starts as its own cluster.
 *   2. Compute pairwise cosine distances between cluster centroids.
 *   3. Merge the closest pair if distance < threshold.
 *   4. Recompute the merged cluster's centroid (normalized mean).
 *   5. Repeat until no pair is below the threshold.
 *   6. Return an integer label per input vector.
 */

import { cosineSimilarity, normalizedMean } from "./utils.js";

interface ClusterNode {
  members: number[]; // indices into the original vector array
  centroid: number[];
}

export interface AgglomerativeOptions {
  /** Maximum cosine distance (1 - similarity) to allow a merge. */
  distanceThreshold: number;
}

/**
 * Run agglomerative clustering on the given vectors.
 *
 * @returns An array of integer labels, one per input vector.
 *          Vectors with the same label belong to the same cluster.
 */
export function agglomerativeClustering(
  vectors: number[][],
  options: AgglomerativeOptions,
): number[] {
  const { distanceThreshold } = options;

  if (vectors.length === 0) return [];
  if (vectors.length === 1) return [0];

  // Initialize: each vector is its own cluster
  let clusters: ClusterNode[] = vectors.map((v, i) => ({
    members: [i],
    centroid: v, // assumed already normalized by caller
  }));

  // Iteratively merge closest pair
  while (clusters.length > 1) {
    let minDist = Infinity;
    let mergeI = -1;
    let mergeJ = -1;

    // Find the closest pair of clusters
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const dist = 1 - cosineSimilarity(clusters[i].centroid, clusters[j].centroid);
        if (dist < minDist) {
          minDist = dist;
          mergeI = i;
          mergeJ = j;
        }
      }
    }

    // Stop if the closest pair exceeds the threshold
    if (minDist >= distanceThreshold) break;

    // Merge clusters[mergeI] and clusters[mergeJ]
    const a = clusters[mergeI];
    const b = clusters[mergeJ];

    // Recompute centroid as the normalized mean of all member vectors
    const allMemberVectors = [...a.members, ...b.members].map((idx) => vectors[idx]);
    const merged: ClusterNode = {
      members: [...a.members, ...b.members],
      centroid: normalizedMean(allMemberVectors),
    };

    // Remove the two old clusters (higher index first to avoid shifting)
    clusters.splice(mergeJ, 1);
    clusters.splice(mergeI, 1);
    clusters.push(merged);
  }

  // Assign sequential labels
  const labels = new Array<number>(vectors.length);
  let label = 0;
  for (const cluster of clusters) {
    for (const idx of cluster.members) {
      labels[idx] = label;
    }
    label++;
  }

  return labels;
}
