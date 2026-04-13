/**
 * Database access layer for clustering operations.
 * Port of arali-python/app/core/pipeline.py (ClusterRepository).
 *
 * Uses raw SQL via Drizzle's sql`` template literals to match
 * the Python implementation and handle pgvector operations.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import type { InsightCluster, InsightRow } from "./types.js";
import { EMBEDDING_DIMENSION } from "./types.js";
import {
  buildFeatureText,
  cosineSimilarity,
  incrementalCentroid,
  normalize,
  shouldAssignCluster,
  vectorFromDb,
  vectorToDb,
} from "./utils.js";
import { embedTexts } from "./embeddings.js";

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

export async function fetchInsight(insightId: string): Promise<InsightRow | null> {
  const rows = await db.execute(sql`
    SELECT id, enterprise_id, product_id, metric_key, details_json,
           embedding, cluster_id, created_at
    FROM meeting_insights
    WHERE id = ${insightId}::uuid
  `);
  if (!rows.length) return null;
  const r = rows[0] as Record<string, unknown>;
  return {
    id: String(r.id),
    enterpriseId: String(r.enterprise_id),
    productId: r.product_id ? String(r.product_id) : null,
    metricKey: String(r.metric_key),
    detailsJson: (r.details_json as Record<string, unknown>) ?? null,
    embedding: vectorFromDb(r.embedding),
    clusterId: r.cluster_id ? String(r.cluster_id) : null,
    createdAt: new Date(r.created_at as string),
  };
}

export async function ensureEmbedding(insight: InsightRow): Promise<number[]> {
  if (insight.embedding) return insight.embedding;
  const text = buildFeatureText(insight.detailsJson);
  const [vector] = await embedTexts([text]);
  await db.execute(sql`
    UPDATE meeting_insights
    SET embedding = ${vectorToDb(vector)}::vector
    WHERE id = ${insight.id}::uuid
  `);
  return vector;
}

export async function fetchClusters(
  enterpriseId: string,
  metricKey: string,
): Promise<InsightCluster[]> {
  const rows = await db.execute(sql`
    SELECT id, enterprise_id, product_id, metric_key, centroid, size, created_at,
           is_seeded, merged_into, merged_at, first_seen_at, metadata, name, description, type
    FROM insight_clusters
    WHERE enterprise_id = ${enterpriseId}::uuid
      AND metric_key = ${metricKey}
      AND merged_into IS NULL
  `);
  return (rows as Record<string, unknown>[]).map(mapClusterRow);
}

// ---------------------------------------------------------------------------
// Cluster selection
// ---------------------------------------------------------------------------

export function selectCluster(
  embedding: number[],
  clusters: InsightCluster[],
): InsightCluster | null {
  let best: InsightCluster | null = null;
  let bestSim = -1;
  for (const c of clusters) {
    if (!c.centroid || c.centroid.length === 0) continue;
    const sim = cosineSimilarity(embedding, c.centroid);
    if (sim > bestSim) {
      bestSim = sim;
      best = c;
    }
  }
  if (best && shouldAssignCluster(best.size, bestSim)) {
    return best;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Embedding backfill
// ---------------------------------------------------------------------------

export async function backfillEmbeddings(
  batchSize: number,
  metricKey: string,
): Promise<number> {
  let total = 0;
  let batchNum = 0;

  while (true) {
    const rows = await db.execute(sql`
      SELECT id, details_json
      FROM meeting_insights
      WHERE metric_key = ${metricKey}
        AND embedding IS NULL
      ORDER BY created_at
      LIMIT ${batchSize}
    `);
    if (!rows.length) break;
    batchNum++;
    console.log(`[clustering] Backfilling embeddings: batch ${batchNum}, ${rows.length} insights`);

    const typedRows = rows as unknown as Array<{ id: string; details_json: unknown }>;
    const texts = typedRows.map((r) =>
      buildFeatureText(r.details_json as Record<string, unknown> | null),
    );
    const vectors = await embedTexts(texts);

    for (let i = 0; i < typedRows.length; i++) {
      await db.execute(sql`
        UPDATE meeting_insights
        SET embedding = ${vectorToDb(vectors[i])}::vector
        WHERE id = ${typedRows[i].id}::uuid
      `);
      total++;
    }
  }

  console.log(`[clustering] Backfill complete: ${total} insights in ${batchNum} batches`);
  return total;
}

// ---------------------------------------------------------------------------
// Batch cluster assignment
// ---------------------------------------------------------------------------

export async function assignClusters(
  batchSize: number,
  metricKey: string,
): Promise<[number, number]> {
  let assignedTotal = 0;
  let updatedClusters = 0;
  const clusterCache = new Map<string, InsightCluster[]>();
  const clusterLookup = new Map<string, InsightCluster>();
  let batchNum = 0;

  while (true) {
    const rows = await db.execute(sql`
      SELECT id, enterprise_id, product_id, embedding
      FROM meeting_insights
      WHERE metric_key = ${metricKey}
        AND cluster_id IS NULL
        AND embedding IS NOT NULL
      ORDER BY created_at
      LIMIT ${batchSize}
    `);
    if (!rows.length) break;
    batchNum++;
    console.log(`[clustering] Assigning clusters: batch ${batchNum}, ${rows.length} insights`);

    const assignments: Array<[string, string]> = [];
    const vectorsByCluster = new Map<string, number[][]>();

    for (const rawRow of rows) {
      const row = rawRow as Record<string, unknown>;
      const eid = String(row.enterprise_id);
      let clusters = clusterCache.get(eid);
      if (clusters === undefined) {
        clusters = await fetchClusters(eid, metricKey);
        clusterCache.set(eid, clusters);
        for (const c of clusters) clusterLookup.set(c.id, c);
      }
      if (!clusters.length) continue;

      const embedding = vectorFromDb(row.embedding);
      if (!embedding) continue;

      const best = selectCluster(embedding, clusters);
      if (!best) continue;

      assignments.push([String(row.id), best.id]);
      const existing = vectorsByCluster.get(best.id) ?? [];
      existing.push(embedding);
      vectorsByCluster.set(best.id, existing);
    }

    if (!assignments.length) {
      console.log(`[clustering] No assignments in batch ${batchNum}, stopping`);
      break;
    }

    for (const [insightId, clusterId] of assignments) {
      await db.execute(sql`
        UPDATE meeting_insights SET cluster_id = ${clusterId}
        WHERE id = ${insightId}::uuid
      `);
    }
    assignedTotal += assignments.length;

    for (const [clusterId, vectors] of vectorsByCluster) {
      const cluster = clusterLookup.get(clusterId);
      if (!cluster) continue;
      const [newCentroid, newSize] = incrementalCentroid(
        cluster.centroid,
        cluster.size,
        vectors,
      );
      await updateClusterVector(clusterId, newCentroid, newSize);
      cluster.centroid = newCentroid;
      cluster.size = newSize;
      updatedClusters++;
    }
  }

  console.log(
    `[clustering] Assignment complete: ${assignedTotal} insights, ${updatedClusters} clusters in ${batchNum} batches`,
  );
  return [assignedTotal, updatedClusters];
}

// ---------------------------------------------------------------------------
// Cluster mutations
// ---------------------------------------------------------------------------

export async function updateClusterVector(
  clusterId: string,
  centroid: number[],
  size: number,
): Promise<void> {
  await db.execute(sql`
    UPDATE insight_clusters
    SET centroid = ${vectorToDb(centroid)}::vector,
        size = ${size},
        updated_at = NOW()
    WHERE id = ${clusterId}
  `);
}

export async function createCluster(params: {
  id: string;
  enterpriseId: string;
  metricKey: string;
  productId?: string | null;
  centroid: number[];
  size: number;
  name?: string | null;
  description?: string | null;
  type?: string | null;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO insight_clusters
      (id, enterprise_id, metric_key, product_id, centroid, size, name, description, type)
    VALUES (
      ${params.id},
      ${params.enterpriseId}::uuid,
      ${params.metricKey},
      ${params.productId ?? null},
      ${vectorToDb(params.centroid)}::vector,
      ${params.size},
      ${params.name ?? null},
      ${params.description ?? null},
      ${params.type ?? null}
    )
  `);
}

export async function assignInsightToCluster(
  insightId: string,
  clusterId: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE meeting_insights SET cluster_id = ${clusterId}
    WHERE id = ${insightId}::uuid
  `);
}

export async function batchAssignInsights(
  assignments: Array<[string, string]>,
): Promise<void> {
  for (const [insightId, clusterId] of assignments) {
    await db.execute(sql`
      UPDATE meeting_insights SET cluster_id = ${clusterId}
      WHERE id = ${insightId}::uuid
    `);
  }
}

export async function incrementClusterSize(
  clusterId: string,
  delta: number,
): Promise<void> {
  await db.execute(sql`
    UPDATE insight_clusters
    SET size = size + ${delta}, updated_at = NOW()
    WHERE id = ${clusterId}
  `);
}

// ---------------------------------------------------------------------------
// Enterprise / metric listing
// ---------------------------------------------------------------------------

export async function listEnterpriseMetricPairs(
  metricKey: string,
  enterpriseId?: string,
): Promise<string[]> {
  if (enterpriseId) {
    return [enterpriseId];
  }
  const rows = await db.execute(sql`
    SELECT DISTINCT enterprise_id
    FROM meeting_insights
    WHERE metric_key = ${metricKey}
      AND embedding IS NOT NULL
  `);
  return (rows as unknown as Array<{ enterprise_id: string }>).map((r) =>
    String(r.enterprise_id),
  );
}

export async function listClusterEnterprises(
  metricKey: string,
  enterpriseId?: string,
): Promise<string[]> {
  if (enterpriseId) {
    return [enterpriseId];
  }
  const rows = await db.execute(sql`
    SELECT DISTINCT enterprise_id
    FROM insight_clusters
    WHERE metric_key = ${metricKey}
      AND merged_into IS NULL
  `);
  return (rows as unknown as Array<{ enterprise_id: string }>).map((r) =>
    String(r.enterprise_id),
  );
}

// ---------------------------------------------------------------------------
// Fetchers for maintenance / bootstrap
// ---------------------------------------------------------------------------

export async function fetchEmbeddingsForPair(
  enterpriseId: string,
  metricKey: string,
): Promise<Array<{ id: string; embedding: number[] }>> {
  const rows = await db.execute(sql`
    SELECT id, embedding
    FROM meeting_insights
    WHERE enterprise_id = ${enterpriseId}::uuid
      AND metric_key = ${metricKey}
      AND embedding IS NOT NULL
  `);
  return (rows as unknown as Array<{ id: string; embedding: unknown }>).map((r) => ({
    id: String(r.id),
    embedding: vectorFromDb(r.embedding) ?? [],
  }));
}

export async function fetchUnclusteredEmbeddings(
  enterpriseId: string,
  metricKey: string,
): Promise<Array<{ id: string; embedding: number[] }>> {
  const rows = await db.execute(sql`
    SELECT id, embedding
    FROM meeting_insights
    WHERE enterprise_id = ${enterpriseId}::uuid
      AND metric_key = ${metricKey}
      AND embedding IS NOT NULL
      AND cluster_id IS NULL
  `);
  return (rows as unknown as Array<{ id: string; embedding: unknown }>).map((r) => ({
    id: String(r.id),
    embedding: vectorFromDb(r.embedding) ?? [],
  }));
}

export async function fetchClusterInsights(
  clusterId: string,
  metricKey: string,
  limit = 10,
): Promise<Array<{ id: string; details_json: Record<string, unknown> | null }>> {
  const rows = await db.execute(sql`
    SELECT id, details_json
    FROM meeting_insights
    WHERE cluster_id = ${clusterId}
      AND metric_key = ${metricKey}
    LIMIT ${limit}
  `);
  return (rows as unknown as Array<{ id: string; details_json: unknown }>).map((r) => ({
    id: String(r.id),
    details_json: (r.details_json as Record<string, unknown>) ?? null,
  }));
}

export async function fetchUnclusteredInsights(
  enterpriseId: string,
  metricKey: string,
): Promise<InsightRow[]> {
  const rows = await db.execute(sql`
    SELECT id, enterprise_id, product_id, metric_key, details_json,
           embedding, cluster_id, created_at
    FROM meeting_insights
    WHERE enterprise_id = ${enterpriseId}::uuid
      AND metric_key = ${metricKey}
      AND cluster_id IS NULL
  `);
  return (rows as Record<string, unknown>[]).map(mapInsightRow);
}

// ---------------------------------------------------------------------------
// Merge / recalculate
// ---------------------------------------------------------------------------

export function chooseWinner(
  a: InsightCluster,
  b: InsightCluster,
): [InsightCluster, InsightCluster] {
  if (a.size > b.size) return [a, b];
  if (b.size > a.size) return [b, a];
  return a.createdAt <= b.createdAt ? [a, b] : [b, a];
}

export function mergeCentroids(
  winner: InsightCluster,
  loser: InsightCluster,
): [number[], number] {
  const dim = winner.centroid.length;
  const total = new Array<number>(dim);
  const combinedSize = winner.size + loser.size;
  for (let i = 0; i < dim; i++) {
    total[i] =
      (winner.centroid[i] * winner.size + loser.centroid[i] * loser.size) /
      combinedSize;
  }
  return [normalize(total), combinedSize];
}

export async function executeMerge(
  winnerId: string,
  loserId: string,
  newCentroid: number[],
  newSize: number,
): Promise<void> {
  // Reassign all insights from loser to winner
  await db.execute(sql`
    UPDATE meeting_insights SET cluster_id = ${winnerId}
    WHERE cluster_id = ${loserId}
  `);
  // Update winner centroid & size
  await updateClusterVector(winnerId, newCentroid, newSize);
  // Mark loser as merged
  await db.execute(sql`
    UPDATE insight_clusters
    SET merged_into = ${winnerId}, merged_at = NOW(), updated_at = NOW()
    WHERE id = ${loserId}
  `);
}

export async function recalculateCentroid(clusterId: string): Promise<void> {
  const rows = await db.execute(sql`
    SELECT embedding
    FROM meeting_insights
    WHERE cluster_id = ${clusterId}
      AND embedding IS NOT NULL
  `);
  const vectors = (rows as unknown as Array<{ embedding: unknown }>)
    .map((r) => vectorFromDb(r.embedding))
    .filter((v): v is number[] => v !== null && v.length > 0);

  if (vectors.length === 0) return;

  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += vec[i];
  }
  for (let i = 0; i < dim; i++) sum[i] /= vectors.length;
  const centroid = normalize(sum);

  await db.execute(sql`
    UPDATE insight_clusters
    SET centroid = ${vectorToDb(centroid)}::vector,
        size = ${vectors.length},
        updated_at = NOW()
    WHERE id = ${clusterId}
  `);
}

// ---------------------------------------------------------------------------
// Snapshot cluster size history
// ---------------------------------------------------------------------------

export async function snapshotClusterHistory(
  enterpriseId: string,
  metricKey: string,
): Promise<void> {
  const clusters = await fetchClusters(enterpriseId, metricKey);
  const today = new Date().toISOString().slice(0, 10);

  for (const c of clusters) {
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    const history = (Array.isArray(meta.size_history) ? meta.size_history : []) as Array<{
      date: string;
      size: number;
    }>;
    history.push({ date: today, size: c.size });
    // Keep last 12 entries
    const trimmed = history.slice(-12);
    const newMeta = { ...meta, size_history: trimmed };

    await db.execute(sql`
      UPDATE insight_clusters
      SET metadata = ${JSON.stringify(newMeta)}::jsonb,
          updated_at = NOW()
      WHERE id = ${c.id}
    `);
  }
}

export async function updateClusterLabel(
  clusterId: string,
  name: string,
  description: string,
  type: string | null,
): Promise<void> {
  await db.execute(sql`
    UPDATE insight_clusters
    SET name = ${name},
        description = ${description},
        type = ${type},
        updated_at = NOW()
    WHERE id = ${clusterId}
  `);
}

// ---------------------------------------------------------------------------
// Insight prompt helpers
// ---------------------------------------------------------------------------

export function insightPromptRecord(
  details: Record<string, unknown> | string | null,
): { title: string; summary: string } {
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

  const objection = String(data.objection_summary ?? "").trim();
  if (objection) return { title: "Objection", summary: objection };

  const title = String(data.feature_title ?? "").trim() || "Untitled Insight";
  const summary = String(data.feature_summary ?? "").trim();
  return { title, summary };
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function mapClusterRow(r: Record<string, unknown>): InsightCluster {
  const meta = r.metadata;
  let parsedMeta: Record<string, unknown>;
  if (typeof meta === "string") {
    try {
      parsedMeta = JSON.parse(meta);
    } catch {
      parsedMeta = {};
    }
  } else {
    parsedMeta = (meta as Record<string, unknown>) ?? {};
  }

  return {
    id: String(r.id),
    enterpriseId: String(r.enterprise_id),
    productId: r.product_id ? String(r.product_id) : null,
    metricKey: String(r.metric_key),
    centroid: vectorFromDb(r.centroid) ?? new Array<number>(EMBEDDING_DIMENSION).fill(0),
    size: Number(r.size),
    createdAt: new Date(r.created_at as string),
    isSeeded: Boolean(r.is_seeded),
    mergedInto: r.merged_into ? String(r.merged_into) : null,
    mergedAt: r.merged_at ? new Date(r.merged_at as string) : null,
    firstSeenAt: r.first_seen_at ? new Date(r.first_seen_at as string) : null,
    metadata: parsedMeta,
    name: r.name ? String(r.name) : null,
    description: r.description ? String(r.description) : null,
    type: r.type ? String(r.type) : null,
  };
}

function mapInsightRow(r: Record<string, unknown>): InsightRow {
  return {
    id: String(r.id),
    enterpriseId: String(r.enterprise_id),
    productId: r.product_id ? String(r.product_id) : null,
    metricKey: String(r.metric_key),
    detailsJson: (r.details_json as Record<string, unknown>) ?? null,
    embedding: vectorFromDb(r.embedding),
    clusterId: r.cluster_id ? String(r.cluster_id) : null,
    createdAt: new Date(r.created_at as string),
  };
}
