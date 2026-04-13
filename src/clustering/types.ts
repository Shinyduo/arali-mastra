import { z } from "zod";

// ---------------------------------------------------------------------------
// Request / Response schemas
// ---------------------------------------------------------------------------

export const OnlineTaskRequestSchema = z.object({
  insight_id: z.string().uuid(),
});

export const DailyTaskRequestSchema = z.object({
  batch_size: z.number().int().min(1).max(2000).default(200),
});

export const WeeklyTaskRequestSchema = z.object({
  enterprise_id: z.string().uuid().nullish(),
});

export const BootstrapRequestSchema = z.object({
  enterprise_id: z.string().uuid(),
  metric_key: z.string(),
});

export const TrendsQuerySchema = z.object({
  enterprise_id: z.string().uuid(),
  metric_key: z.string(),
  days: z.coerce.number().int().min(1).default(30),
});

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface InsightCluster {
  id: string;
  enterpriseId: string;
  productId: string | null;
  metricKey: string;
  centroid: number[];
  size: number;
  createdAt: Date;
  isSeeded: boolean;
  mergedInto: string | null;
  mergedAt: Date | null;
  firstSeenAt: Date | null;
  metadata: Record<string, unknown>;
  name: string | null;
  description: string | null;
  type: string | null;
}

export interface InsightRow {
  id: string;
  enterpriseId: string;
  productId: string | null;
  metricKey: string;
  detailsJson: Record<string, unknown> | null;
  embedding: number[] | null;
  clusterId: string | null;
  createdAt: Date;
}

export interface TrendItem {
  id: string;
  name: string | null;
  description: string | null;
  type: string | null;
  is_seeded: boolean;
  first_seen_at: Date | null;
  current_size: number;
  mentions_7d: number;
  mentions_30d: number;
  mentions_prev_30d: number;
  velocity: number;
  acceleration: number;
  trend_label: string;
  sample_insights: Array<{ evidence: string; timestamp: string | null }>;
}

export interface TrendsSummary {
  total_clusters: number;
  total_insights_30d: number;
  new_signals_count: number;
  growing_count: number;
  top_trend: string | null;
  fastest_growing: string | null;
}

export interface TrendsResponse {
  trends: TrendItem[];
  summary: TrendsSummary;
}

export interface DailyTaskResponse {
  message: string;
  embedded: number;
  assigned: number;
  clusters_updated: number;
}

export interface MaintenanceResult {
  enterprise_id: string;
  metric_key: string;
  result: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Labeler types
// ---------------------------------------------------------------------------

export interface LabelPayload {
  cluster_id: string;
  enterprise_id: string;
  metric_key: string;
  insights: Array<{ title: string; summary: string }>;
}

export interface LabelResult {
  name: string;
  description: string;
  type: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const METRIC_KEYS = ["feature_reception", "competitor_mentions"] as const;

/** Metrics that support vector-based clustering (competitor_mentions uses fuzzy matching) */
export const CLUSTERABLE_METRIC_KEYS = [
  "feature_reception",
  "objections_handling",
  "competitor_mentions",
] as const;

/** Distance thresholds for agglomerative clustering (lower = stricter) */
export const DISTANCE_THRESHOLDS: Record<string, number> = {
  feature_reception: 0.54,
  competitor_mentions: 0.45,
};
export const DEFAULT_DISTANCE_THRESHOLD = 0.54;

/** Cosine similarity threshold for online assignment */
export const ONLINE_ASSIGNMENT_THRESHOLD = 0.72;

/** Cosine similarity threshold for merge detection */
export const MERGE_SIMILARITY_THRESHOLD = 0.85;

/** Fuzzy match thresholds for competitor clustering */
export const COMPETITOR_ASSIGN_THRESHOLD = 0.70;
export const COMPETITOR_MERGE_THRESHOLD = 0.80;

export const EMBEDDING_DIMENSION = 3072;
