/**
 * Core clustering orchestrator.
 * Port of arali-python/app/core/clustering/service.py (ClusteringService).
 */

import { agglomerativeClustering } from "./agglomerative.js";
import { labelCluster } from "./labeler.js";
import * as repo from "./repository.js";
import type { InsightCluster, LabelPayload } from "./types.js";
import {
  DISTANCE_THRESHOLDS,
  DEFAULT_DISTANCE_THRESHOLD,
  MERGE_SIMILARITY_THRESHOLD,
  ONLINE_ASSIGNMENT_THRESHOLD,
} from "./types.js";
import {
  cosineSimilarity,
  incrementalCentroid,
  normalizedMean,
} from "./utils.js";
import { assignInsightCompetitor, bootstrapCompetitor, runCompetitorMaintenance } from "./competitor-service.js";

// ---------------------------------------------------------------------------
// Online assignment (single insight)
// ---------------------------------------------------------------------------

export async function assignInsight(insightId: string): Promise<string | null> {
  const insight = await repo.fetchInsight(insightId);
  if (!insight) return null;

  // Route competitor mentions to fuzzy matching
  if (insight.metricKey === "competitor_mentions") {
    return assignInsightCompetitor(insightId);
  }

  // Ensure embedding exists
  const embedding = await repo.ensureEmbedding(insight);

  // Fetch active clusters
  const clusters = await repo.fetchClusters(insight.enterpriseId, insight.metricKey);

  // Find best match
  let bestCluster: InsightCluster | null = null;
  let bestSim = -1;

  for (const c of clusters) {
    if (!c.centroid || c.centroid.length === 0) continue;
    const sim = cosineSimilarity(embedding, c.centroid);
    if (sim > bestSim) {
      bestSim = sim;
      bestCluster = c;
    }
  }

  if (bestCluster && bestSim >= ONLINE_ASSIGNMENT_THRESHOLD) {
    // Assign
    await repo.assignInsightToCluster(insightId, bestCluster.id);

    // Update centroid incrementally
    const [newCentroid, newSize] = incrementalCentroid(
      bestCluster.centroid,
      bestCluster.size,
      [embedding],
    );
    await repo.updateClusterVector(bestCluster.id, newCentroid, newSize);

    // Regenerate label (non-blocking)
    regenerateClusterLabel(bestCluster.id, insight.enterpriseId, insight.metricKey).catch(
      (err) => console.error(`[clustering] Failed to regenerate label for ${bestCluster!.id}:`, err),
    );

    console.log(
      `[clustering] Assigned insight ${insightId} to cluster ${bestCluster.id} (sim=${bestSim.toFixed(2)})`,
    );
    return bestCluster.id;
  }

  console.log(
    `[clustering] No match for insight ${insightId} (bestSim=${bestSim.toFixed(2)})`,
  );
  return null;
}

// ---------------------------------------------------------------------------
// Weekly maintenance
// ---------------------------------------------------------------------------

export async function runMaintenance(
  enterpriseId: string,
  metricKey: string,
): Promise<{ new_clusters: number; merges: number }> {
  console.log(`[clustering] Running maintenance for ${enterpriseId} (${metricKey})`);

  // Route competitor mentions
  if (metricKey === "competitor_mentions") {
    return runCompetitorMaintenance(enterpriseId, metricKey);
  }

  // Step 1: Snapshot size history
  await repo.snapshotClusterHistory(enterpriseId, metricKey);

  // Step 2: Cluster unclustered insights
  const newClusters = await processUnclustered(enterpriseId, metricKey);

  // Step 3: Merge similar clusters
  const merges = await mergeClusters(enterpriseId, metricKey);

  // Step 4: Recalculate centroids
  await recalculateCentroids(enterpriseId, metricKey);

  return { new_clusters: newClusters, merges };
}

// ---------------------------------------------------------------------------
// Bootstrap (one-time full clustering)
// ---------------------------------------------------------------------------

export async function bootstrap(
  enterpriseId: string,
  metricKey: string,
): Promise<void> {
  // Route competitor mentions
  if (metricKey === "competitor_mentions") {
    await bootstrapCompetitor(enterpriseId, metricKey);
    return;
  }

  console.log(`[clustering] Bootstrap for ${enterpriseId} (${metricKey})`);

  // Fetch all insights with embeddings
  const allData = await repo.fetchEmbeddingsForPair(enterpriseId, metricKey);
  if (allData.length === 0) {
    console.log(`[clustering] Bootstrap: no insights with embeddings`);
    return;
  }

  console.log(`[clustering] Bootstrap: ${allData.length} insights`);

  // Agglomerative clustering
  const vectors = allData.map((d) => d.embedding);
  const ids = allData.map((d) => d.id);
  const threshold = DISTANCE_THRESHOLDS[metricKey] ?? DEFAULT_DISTANCE_THRESHOLD;
  const labels = agglomerativeClustering(vectors, { distanceThreshold: threshold });

  const uniqueLabels = [...new Set(labels)];
  console.log(`[clustering] Bootstrap: ${uniqueLabels.length} groups`);

  const activeClusters = await repo.fetchClusters(enterpriseId, metricKey);
  const clustersToLabel: string[] = [];
  let createdNew = 0;
  let assignedExisting = 0;
  let skippedSmall = 0;

  // PHASE 1: Create clusters quickly (no labels)
  for (const label of uniqueLabels) {
    const idxs = labels.reduce<number[]>((acc, l, i) => {
      if (l === label) acc.push(i);
      return acc;
    }, []);

    const groupVectors = idxs.map((i) => vectors[i]);
    const groupIds = idxs.map((i) => ids[i]);
    const centroid = normalizedMean(groupVectors);

    // Check against existing clusters
    let bestExisting: InsightCluster | null = null;
    let bestSim = MERGE_SIMILARITY_THRESHOLD;

    for (const existing of activeClusters) {
      const sim = cosineSimilarity(centroid, existing.centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestExisting = existing;
      }
    }

    let targetClusterId: string | null = null;

    if (bestExisting) {
      targetClusterId = bestExisting.id;
      const [newC, newS] = incrementalCentroid(bestExisting.centroid, bestExisting.size, groupVectors);
      await repo.updateClusterVector(bestExisting.id, newC, newS);
      bestExisting.centroid = newC;
      bestExisting.size = newS;
      assignedExisting++;
    } else {
      if (groupIds.length < 2) {
        skippedSmall++;
        continue;
      }

      targetClusterId = crypto.randomUUID();

      await repo.createCluster({
        id: targetClusterId,
        enterpriseId,
        metricKey,
        centroid,
        size: groupIds.length,
      });

      activeClusters.push({
        id: targetClusterId,
        enterpriseId,
        productId: null,
        metricKey,
        centroid,
        size: groupIds.length,
        createdAt: new Date(),
        isSeeded: false,
        mergedInto: null,
        mergedAt: null,
        firstSeenAt: new Date(),
        metadata: {},
        name: null,
        description: null,
        type: null,
      });

      clustersToLabel.push(targetClusterId);
      createdNew++;
    }

    if (targetClusterId) {
      await repo.batchAssignInsights(groupIds.map((gid) => [gid, targetClusterId!]));
    }
  }

  console.log(
    `[clustering] Bootstrap Phase 1: created ${createdNew}, existing ${assignedExisting}, skipped ${skippedSmall}`,
  );

  // PHASE 2: Label new clusters
  console.log(`[clustering] Bootstrap Phase 2: labeling ${clustersToLabel.length} clusters`);
  let labeled = 0;
  let failed = 0;

  for (let i = 0; i < clustersToLabel.length; i++) {
    const clusterId = clustersToLabel[i];
    try {
      // Fetch details_json for the sample insights
      const sampleInsights = await repo.fetchClusterInsights(clusterId, metricKey, 10);
      const payload: LabelPayload = {
        cluster_id: clusterId,
        enterprise_id: enterpriseId,
        metric_key: metricKey,
        insights: sampleInsights.map((r) => repo.insightPromptRecord(r.details_json)),
      };
      const lbl = await labelCluster(payload);
      await repo.updateClusterLabel(clusterId, lbl.name, lbl.description, lbl.type);
      labeled++;
      console.log(`[clustering] Bootstrap Phase 2: [${i + 1}/${clustersToLabel.length}] '${lbl.name}'`);
    } catch (err) {
      failed++;
      console.error(`[clustering] Bootstrap Phase 2: failed cluster ${clusterId}:`, err);
    }
  }

  console.log(
    `[clustering] Bootstrap complete: ${createdNew} new, ${assignedExisting} existing, ` +
      `${skippedSmall} skipped, ${labeled} labeled, ${failed} failed`,
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function regenerateClusterLabel(
  clusterId: string,
  enterpriseId: string,
  metricKey: string,
): Promise<void> {
  const sampleInsights = await repo.fetchClusterInsights(clusterId, metricKey, 10);
  if (sampleInsights.length === 0) return;

  const payload: LabelPayload = {
    cluster_id: clusterId,
    enterprise_id: enterpriseId,
    metric_key: metricKey,
    insights: sampleInsights.map((r) => repo.insightPromptRecord(r.details_json)),
  };

  const lbl = await labelCluster(payload);
  await repo.updateClusterLabel(clusterId, lbl.name, lbl.description, lbl.type);
  console.log(`[clustering] Regenerated label for ${clusterId}: '${lbl.name}'`);
}

async function processUnclustered(
  enterpriseId: string,
  metricKey: string,
): Promise<number> {
  const data = await repo.fetchUnclusteredEmbeddings(enterpriseId, metricKey);
  if (data.length < 2) return 0;

  const vectors = data.map((d) => d.embedding);
  const ids = data.map((d) => d.id);

  const threshold = DISTANCE_THRESHOLDS[metricKey] ?? DEFAULT_DISTANCE_THRESHOLD;
  const labels = agglomerativeClustering(vectors, { distanceThreshold: threshold });

  let newClustersCreated = 0;
  const activeClusters = await repo.fetchClusters(enterpriseId, metricKey);

  for (const label of new Set(labels)) {
    const idxs = labels.reduce<number[]>((acc, l, i) => {
      if (l === label) acc.push(i);
      return acc;
    }, []);

    if (idxs.length < 2) continue;

    const groupVectors = idxs.map((i) => vectors[i]);
    const groupIds = idxs.map((i) => ids[i]);
    const centroid = normalizedMean(groupVectors);

    // Check against existing
    let bestExisting: InsightCluster | null = null;
    let bestSim = MERGE_SIMILARITY_THRESHOLD;

    for (const existing of activeClusters) {
      const sim = cosineSimilarity(centroid, existing.centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestExisting = existing;
      }
    }

    if (bestExisting) {
      await repo.batchAssignInsights(groupIds.map((gid) => [gid, bestExisting!.id]));
      const [newC, newS] = incrementalCentroid(bestExisting.centroid, bestExisting.size, groupVectors);
      await repo.updateClusterVector(bestExisting.id, newC, newS);
      bestExisting.centroid = newC;
      bestExisting.size = newS;
    } else {
      const newId = crypto.randomUUID();

      // Label the new cluster
      const sampleDetails = await Promise.all(
        idxs.slice(0, 10).map(async (idx) => {
          const insight = await repo.fetchInsight(ids[idx]);
          return insight?.detailsJson ?? null;
        }),
      );

      const payload: LabelPayload = {
        cluster_id: newId,
        enterprise_id: enterpriseId,
        metric_key: metricKey,
        insights: sampleDetails.map((d) => repo.insightPromptRecord(d)),
      };

      let name: string | null = null;
      let description: string | null = null;
      let type: string | null = null;
      try {
        const lbl = await labelCluster(payload);
        name = lbl.name;
        description = lbl.description;
        type = lbl.type;
      } catch (err) {
        console.error(`[clustering] Failed to label new cluster:`, err);
      }

      await repo.createCluster({
        id: newId,
        enterpriseId,
        metricKey,
        centroid,
        size: groupIds.length,
        name,
        description,
        type,
      });

      await repo.batchAssignInsights(groupIds.map((gid) => [gid, newId]));
      newClustersCreated++;

      activeClusters.push({
        id: newId,
        enterpriseId,
        productId: null,
        metricKey,
        centroid,
        size: groupIds.length,
        createdAt: new Date(),
        isSeeded: false,
        mergedInto: null,
        mergedAt: null,
        firstSeenAt: new Date(),
        metadata: {},
        name,
        description,
        type,
      });
    }
  }

  return newClustersCreated;
}

async function mergeClusters(
  enterpriseId: string,
  metricKey: string,
): Promise<number> {
  const clusters = await repo.fetchClusters(enterpriseId, metricKey);
  clusters.sort((a, b) => {
    const aTime = new Date(a.firstSeenAt ?? a.createdAt).getTime();
    const bTime = new Date(b.firstSeenAt ?? b.createdAt).getTime();
    return aTime - bTime;
  });

  let merges = 0;
  const mergedIds = new Set<string>();

  for (let i = 0; i < clusters.length; i++) {
    const c1 = clusters[i];
    if (mergedIds.has(c1.id)) continue;

    for (let j = i + 1; j < clusters.length; j++) {
      const c2 = clusters[j];
      if (mergedIds.has(c2.id)) continue;

      // Never merge seeded into seeded
      if (c1.isSeeded && c2.isSeeded) continue;

      const sim = cosineSimilarity(c1.centroid, c2.centroid);
      if (sim > MERGE_SIMILARITY_THRESHOLD) {
        let winner = c1;
        let loser = c2;
        if (c2.isSeeded && !c1.isSeeded) {
          winner = c2;
          loser = c1;
        }

        const [newCentroid, newSize] = repo.mergeCentroids(winner, loser);
        await repo.executeMerge(winner.id, loser.id, newCentroid, newSize);
        mergedIds.add(loser.id);
        merges++;

        winner.centroid = newCentroid;
        winner.size = newSize;
      }
    }
  }

  return merges;
}

async function recalculateCentroids(
  enterpriseId: string,
  metricKey: string,
): Promise<void> {
  const clusters = await repo.fetchClusters(enterpriseId, metricKey);
  for (const c of clusters) {
    await repo.recalculateCentroid(c.id);
  }
}
