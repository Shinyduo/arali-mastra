/**
 * Competitor clustering service using fuzzy string matching.
 * Port of arali-python/app/core/clustering/competitor_service.py.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { labelCluster } from "./labeler.js";
import { fuzzyMatchScore, clusterByFuzzyMatch } from "./fuzzy-match.js";
import * as repo from "./repository.js";
import type { InsightCluster } from "./types.js";
import {
  COMPETITOR_ASSIGN_THRESHOLD,
  COMPETITOR_MERGE_THRESHOLD,
  EMBEDDING_DIMENSION,
} from "./types.js";
import { buildFeatureText, vectorToDb, zeroVector } from "./utils.js";

// ---------------------------------------------------------------------------
// Online assignment
// ---------------------------------------------------------------------------

export async function assignInsightCompetitor(insightId: string): Promise<string | null> {
  const insight = await repo.fetchInsight(insightId);
  if (!insight) {
    console.warn(`[clustering] Competitor insight ${insightId} not found`);
    return null;
  }

  const competitorName = buildFeatureText(insight.detailsJson);
  if (!competitorName) {
    console.warn(`[clustering] Insight ${insightId} has no competitor_name`);
    return null;
  }

  const clusters = await fetchCompetitorClusters(insight.enterpriseId, insight.metricKey);

  if (clusters.length === 0) {
    // No clusters yet — create first one
    const clusterId = await createCompetitorCluster(
      insight.enterpriseId,
      insight.metricKey,
      competitorName,
      insight.productId,
    );
    await repo.assignInsightToCluster(insightId, clusterId);
    console.log(`[clustering] Created new competitor cluster ${clusterId} for '${competitorName}'`);
    return clusterId;
  }

  // Find best fuzzy match
  let bestCluster: InsightCluster | null = null;
  let bestScore = 0;

  for (const c of clusters) {
    const score = fuzzyMatchScore(competitorName, c.name ?? "");
    if (score > bestScore) {
      bestScore = score;
      bestCluster = c;
    }
  }

  if (bestCluster && bestScore >= COMPETITOR_ASSIGN_THRESHOLD) {
    await repo.assignInsightToCluster(insightId, bestCluster.id);
    await repo.incrementClusterSize(bestCluster.id, 1);
    console.log(
      `[clustering] Assigned competitor insight to '${bestCluster.name}' (score=${bestScore.toFixed(2)})`,
    );
    return bestCluster.id;
  }

  // No match — create new cluster
  const clusterId = await createCompetitorCluster(
    insight.enterpriseId,
    insight.metricKey,
    competitorName,
    insight.productId,
  );
  await repo.assignInsightToCluster(insightId, clusterId);

  // Generate description
  updateClusterDescription(clusterId).catch((err) =>
    console.error(`[clustering] Failed to update competitor description:`, err),
  );

  console.log(
    `[clustering] Created competitor cluster ${clusterId} for '${competitorName}' (bestMatch=${bestScore.toFixed(2)})`,
  );
  return clusterId;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export async function bootstrapCompetitor(
  enterpriseId: string,
  metricKey: string,
): Promise<{ clusters_created: number; insights_assigned: number }> {
  console.log(`[clustering] Bootstrap competitor for ${enterpriseId} (${metricKey})`);

  const unclustered = await fetchUnclusteredCompetitorInsights(enterpriseId, metricKey);
  if (unclustered.length === 0) {
    console.log(`[clustering] No unclustered competitor insights`);
    return { clusters_created: 0, insights_assigned: 0 };
  }

  // Extract names
  const insightMap = new Map<string, string[]>(); // name → insight IDs
  const names: string[] = [];

  for (const row of unclustered) {
    const name = buildFeatureText(row.detailsJson);
    if (!name) continue;
    names.push(name);
    const existing = insightMap.get(name) ?? [];
    existing.push(row.id);
    insightMap.set(name, existing);
  }

  if (names.length === 0) {
    return { clusters_created: 0, insights_assigned: 0 };
  }

  const fuzzyClusters = clusterByFuzzyMatch(names, COMPETITOR_ASSIGN_THRESHOLD);
  console.log(`[clustering] Competitor bootstrap: ${fuzzyClusters.size} clusters from ${names.length} names`);

  let clustersCreated = 0;
  let insightsAssigned = 0;
  const newClusterIds: string[] = [];

  for (const [canonicalName, variants] of fuzzyClusters) {
    // Check existing
    const existing = await findClusterByName(enterpriseId, metricKey, canonicalName);
    let clusterId: string;

    if (existing) {
      clusterId = existing.id;
    } else {
      clusterId = await createCompetitorCluster(enterpriseId, metricKey, canonicalName);
      clustersCreated++;
      newClusterIds.push(clusterId);
    }

    // Assign all variants
    const allInsightIds: string[] = [];
    for (const variant of variants) {
      const ids = insightMap.get(variant) ?? [];
      allInsightIds.push(...ids);
    }

    if (allInsightIds.length > 0) {
      await repo.batchAssignInsights(allInsightIds.map((id) => [id, clusterId]));
      // Update size
      await db.execute(sql`
        UPDATE insight_clusters SET size = ${allInsightIds.length}, updated_at = NOW()
        WHERE id = ${clusterId}
      `);
      insightsAssigned += allInsightIds.length;
    }
  }

  // Generate descriptions for new clusters
  for (const cid of newClusterIds) {
    await updateClusterDescription(cid).catch((err) =>
      console.error(`[clustering] Failed to generate competitor description:`, err),
    );
  }

  console.log(
    `[clustering] Competitor bootstrap: created ${clustersCreated}, assigned ${insightsAssigned}`,
  );
  return { clusters_created: clustersCreated, insights_assigned: insightsAssigned };
}

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

export async function runCompetitorMaintenance(
  enterpriseId: string,
  metricKey: string,
): Promise<{ new_clusters: number; merges: number }> {
  console.log(`[clustering] Competitor maintenance for ${enterpriseId} (${metricKey})`);

  // Step 1: Bootstrap unclustered
  const bootstrapResult = await bootstrapCompetitor(enterpriseId, metricKey);

  // Step 2: Merge similar clusters
  const merges = await mergeSimilarClusters(enterpriseId, metricKey);

  // Step 3: Snapshot history
  await repo.snapshotClusterHistory(enterpriseId, metricKey);

  return {
    new_clusters: bootstrapResult.clusters_created,
    merges,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchCompetitorClusters(
  enterpriseId: string,
  metricKey: string,
): Promise<InsightCluster[]> {
  // Reuse repo.fetchClusters — same query, competitor clusters just have zero centroids
  return repo.fetchClusters(enterpriseId, metricKey);
}

async function fetchUnclusteredCompetitorInsights(
  enterpriseId: string,
  metricKey: string,
): Promise<Array<{ id: string; detailsJson: Record<string, unknown> | null }>> {
  const rows = await db.execute(sql`
    SELECT id, details_json
    FROM meeting_insights
    WHERE enterprise_id = ${enterpriseId}::uuid
      AND metric_key = ${metricKey}
      AND cluster_id IS NULL
  `);
  return (rows as unknown as Array<{ id: string; details_json: unknown }>).map((r) => ({
    id: String(r.id),
    detailsJson: (r.details_json as Record<string, unknown>) ?? null,
  }));
}

async function findClusterByName(
  enterpriseId: string,
  metricKey: string,
  name: string,
): Promise<InsightCluster | null> {
  const rows = await db.execute(sql`
    SELECT id, enterprise_id, product_id, metric_key, centroid, size, created_at,
           is_seeded, merged_into, merged_at, first_seen_at, metadata, name, description, type
    FROM insight_clusters
    WHERE enterprise_id = ${enterpriseId}::uuid
      AND metric_key = ${metricKey}
      AND name = ${name}
      AND merged_into IS NULL
    LIMIT 1
  `);
  if (!rows.length) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    id: String(r.id),
    enterpriseId: String(r.enterprise_id),
    productId: r.product_id ? String(r.product_id) : null,
    metricKey: String(r.metric_key),
    centroid: [],
    size: Number(r.size),
    createdAt: r.created_at as Date,
    isSeeded: Boolean(r.is_seeded),
    mergedInto: null,
    mergedAt: null,
    firstSeenAt: r.first_seen_at ? (r.first_seen_at as Date) : null,
    metadata: (typeof r.metadata === "string" ? JSON.parse(r.metadata) : r.metadata) as Record<string, unknown> ?? {},
    name: r.name ? String(r.name) : null,
    description: r.description ? String(r.description) : null,
    type: r.type ? String(r.type) : null,
  };
}

async function createCompetitorCluster(
  enterpriseId: string,
  metricKey: string,
  competitorName: string,
  productId?: string | null,
): Promise<string> {
  const clusterId = crypto.randomUUID();
  const zeroVec = zeroVector(EMBEDDING_DIMENSION);

  await db.execute(sql`
    INSERT INTO insight_clusters
      (id, enterprise_id, metric_key, product_id, centroid, size,
       created_at, first_seen_at, is_seeded, name, description, type)
    VALUES (
      ${clusterId},
      ${enterpriseId}::uuid,
      ${metricKey},
      ${productId ?? null},
      ${vectorToDb(zeroVec)}::vector,
      ${1},
      NOW(), NOW(), ${false},
      ${competitorName},
      ${"Competitor: " + competitorName},
      ${"Competitor Reference"}
    )
  `);

  return clusterId;
}

async function mergeSimilarClusters(
  enterpriseId: string,
  metricKey: string,
): Promise<number> {
  const clusters = await fetchCompetitorClusters(enterpriseId, metricKey);
  if (clusters.length < 2) return 0;

  // Sort by size desc, then created_at
  clusters.sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  let merges = 0;
  const mergedIds = new Set<string>();

  for (let i = 0; i < clusters.length; i++) {
    const c1 = clusters[i];
    if (mergedIds.has(c1.id)) continue;

    for (let j = i + 1; j < clusters.length; j++) {
      const c2 = clusters[j];
      if (mergedIds.has(c2.id)) continue;

      const score = fuzzyMatchScore(c1.name ?? "", c2.name ?? "");
      if (score >= COMPETITOR_MERGE_THRESHOLD) {
        // Merge c2 into c1
        await executeCompetitorMerge(c1.id, c2.id);
        mergedIds.add(c2.id);
        merges++;
        console.log(
          `[clustering] Merged competitor '${c2.name}' into '${c1.name}' (score=${score.toFixed(2)})`,
        );
      }
    }
  }

  return merges;
}

async function executeCompetitorMerge(winnerId: string, loserId: string): Promise<void> {
  // Reassign insights
  await db.execute(sql`
    UPDATE meeting_insights SET cluster_id = ${winnerId}
    WHERE cluster_id = ${loserId}
  `);

  // Get loser size
  const loserRows = await db.execute(sql`
    SELECT size FROM insight_clusters WHERE id = ${loserId}
  `);
  const loserSize = Number((loserRows[0] as Record<string, unknown>)?.size ?? 0);

  // Update winner size
  await db.execute(sql`
    UPDATE insight_clusters SET size = size + ${loserSize}, updated_at = NOW()
    WHERE id = ${winnerId}
  `);

  // Mark loser as merged
  await db.execute(sql`
    UPDATE insight_clusters
    SET merged_into = ${winnerId}, merged_at = NOW(), size = 0
    WHERE id = ${loserId}
  `);

  // Update description
  await updateClusterDescription(winnerId);
}

async function updateClusterDescription(clusterId: string): Promise<void> {
  const clusterRows = await db.execute(sql`
    SELECT id, enterprise_id, metric_key, name FROM insight_clusters WHERE id = ${clusterId}
  `);
  if (!clusterRows.length) return;
  const cluster = clusterRows[0] as Record<string, unknown>;

  const insightRows = await db.execute(sql`
    SELECT details_json FROM meeting_insights
    WHERE cluster_id = ${clusterId}
    ORDER BY created_at DESC
    LIMIT 20
  `);
  if (!insightRows.length) return;

  const insights = (insightRows as unknown as Array<{ details_json: unknown }>).map((row) => {
    const details =
      typeof row.details_json === "string"
        ? (JSON.parse(row.details_json) as Record<string, unknown>)
        : (row.details_json as Record<string, unknown>) ?? {};
    const summary = String(details.evidence ?? details.context ?? details.summary ?? "");
    const title = String(details.competitor_name ?? cluster.name ?? "");
    return { title, summary };
  });

  const result = await labelCluster({
    cluster_id: clusterId,
    enterprise_id: String(cluster.enterprise_id),
    metric_key: String(cluster.metric_key),
    insights,
  });

  await db.execute(sql`
    UPDATE insight_clusters
    SET description = ${result.description}, type = ${result.type}, updated_at = NOW()
    WHERE id = ${clusterId}
  `);
}
