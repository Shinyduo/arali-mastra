/**
 * Task orchestration — online, daily, weekly runners.
 * Port of arali-python/app/tasks/{online,daily,weekly}.py.
 */

import * as repo from "./repository.js";
import { assignInsight, bootstrap, runMaintenance } from "./service.js";
import { METRIC_KEYS } from "./types.js";
import type { DailyTaskResponse, MaintenanceResult } from "./types.js";

// ---------------------------------------------------------------------------
// Online — assign a single insight
// ---------------------------------------------------------------------------

export async function runOnline(insightId: string): Promise<string | null> {
  console.log(`[clustering] Online: processing insight ${insightId}`);
  const insight = await repo.fetchInsight(insightId);
  if (!insight) {
    throw new Error(`Insight ${insightId} not found`);
  }
  if (insight.clusterId) {
    console.log(`[clustering] Insight ${insightId} already in cluster ${insight.clusterId}`);
    return insight.clusterId;
  }

  const clusterId = await assignInsight(insightId);

  if (clusterId) {
    console.log(`[clustering] Online: assigned ${insightId} → ${clusterId}`);
  } else {
    console.log(`[clustering] Online: no match for ${insightId}`);
  }

  return clusterId;
}

// ---------------------------------------------------------------------------
// Daily — backfill embeddings + assign
// ---------------------------------------------------------------------------

export async function runDaily(batchSize: number): Promise<DailyTaskResponse> {
  console.log(`[clustering] Daily: batch_size=${batchSize}`);

  let totalEmbedded = 0;
  let totalAssigned = 0;
  let totalUpdated = 0;
  let totalNewClusters = 0;

  for (const key of METRIC_KEYS) {
    console.log(`[clustering] Daily: processing ${key}`);

    // Skip embeddings for competitor_mentions (uses fuzzy matching)
    if (key !== "competitor_mentions") {
      const embedded = await repo.backfillEmbeddings(batchSize, key);
      console.log(`[clustering] Daily [${key}]: backfilled ${embedded} embeddings`);
      totalEmbedded += embedded;
    }

    // Assign unclustered insights to existing clusters
    const [assigned, clustersUpdated] = await repo.assignClusters(batchSize, key);
    console.log(`[clustering] Daily [${key}]: assigned ${assigned}, updated ${clustersUpdated} clusters`);
    totalAssigned += assigned;
    totalUpdated += clustersUpdated;
  }

  console.log(
    `[clustering] Daily complete: embedded=${totalEmbedded}, new_clusters=${totalNewClusters}, ` +
      `assigned=${totalAssigned}, updated=${totalUpdated}`,
  );

  return {
    message: "Daily task completed",
    embedded: totalEmbedded,
    assigned: totalAssigned,
    clusters_updated: totalUpdated,
  };
}

// ---------------------------------------------------------------------------
// Weekly — maintenance per enterprise
// ---------------------------------------------------------------------------

export async function runWeeklyMaintenance(
  targetEnterpriseId?: string,
): Promise<MaintenanceResult[]> {
  console.log(`[clustering] Weekly maintenance starting`);
  const results: MaintenanceResult[] = [];

  for (const key of METRIC_KEYS) {
    const enterprises = targetEnterpriseId
      ? [targetEnterpriseId]
      : await repo.listEnterpriseMetricPairs(key);

    for (const eid of enterprises) {
      try {
        const existingClusters = await repo.fetchClusters(eid, key);

        if (existingClusters.length === 0) {
          // No clusters — run bootstrap
          console.log(`[clustering] No clusters for ${eid} (${key}), running bootstrap`);
          await bootstrap(eid, key);
          results.push({
            enterprise_id: eid,
            metric_key: key,
            result: { action: "bootstrap", status: "completed" },
          });
        } else {
          // Run maintenance
          console.log(`[clustering] Running maintenance for ${eid} (${key})`);
          const res = await runMaintenance(eid, key);
          results.push({
            enterprise_id: eid,
            metric_key: key,
            result: { action: "maintenance", ...res },
          });
        }
      } catch (err) {
        console.error(`[clustering] Error for ${eid} (${key}):`, err);
        results.push({
          enterprise_id: eid,
          metric_key: key,
          result: { action: "error", error: String(err) },
        });
      }
    }
  }

  console.log(`[clustering] Weekly maintenance done: ${results.length} enterprises processed`);
  return results;
}
