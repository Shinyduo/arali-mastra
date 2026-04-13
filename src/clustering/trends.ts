/**
 * Trend analytics for insight clusters.
 * Port of arali-python/app/core/clustering/trends.py.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { insightPromptRecord } from "./repository.js";
import type { TrendItem, TrendsResponse, TrendsSummary } from "./types.js";

const TREND_PRIORITY: Record<string, number> = {
  new_signal: 0,
  emerging: 1,
  growing: 2,
  stable: 3,
  declining: 4,
};

export async function getEmergingTrends(
  enterpriseId: string,
  metricKey: string,
  _days = 30,
): Promise<TrendsResponse> {
  const rows = await db.execute(sql`
    SELECT
      c.id,
      c.name,
      c.description,
      c.type,
      c.is_seeded,
      c.first_seen_at,
      c.size AS current_size,
      c.metadata,
      COUNT(mi.id) FILTER (WHERE mi.created_at > NOW() - INTERVAL '7 days') AS mentions_7d,
      COUNT(mi.id) FILTER (WHERE mi.created_at > NOW() - INTERVAL '30 days') AS mentions_30d,
      COUNT(mi.id) FILTER (WHERE mi.created_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days') AS mentions_prev_30d
    FROM insight_clusters c
    LEFT JOIN meeting_insights mi ON mi.cluster_id = c.id
    WHERE c.enterprise_id = ${enterpriseId}::uuid
      AND c.metric_key = ${metricKey}
      AND c.merged_into IS NULL
    GROUP BY c.id
  `);

  const trends: TrendItem[] = [];
  let totalClusters = 0;
  let totalInsights30d = 0;
  let newSignalsCount = 0;
  let growingCount = 0;

  const now = new Date();

  for (const rawRow of rows) {
    const row = rawRow as Record<string, unknown>;
    totalClusters++;

    const mentions7d = Number(row.mentions_7d ?? 0);
    const mentions30d = Number(row.mentions_30d ?? 0);
    const mentionsPrev30d = Number(row.mentions_prev_30d ?? 0);

    totalInsights30d += mentions30d;

    const velocity = mentions7d / 7;
    let acceleration: number;
    if (mentionsPrev30d > 0) {
      acceleration = (mentions30d - mentionsPrev30d) / mentionsPrev30d;
    } else {
      acceleration = mentions30d > 0 ? 1 : 0;
    }

    const firstSeen = row.first_seen_at ? new Date(row.first_seen_at as string) : now;
    const daysSinceFirstSeen = Math.floor(
      (now.getTime() - firstSeen.getTime()) / (1000 * 60 * 60 * 24),
    );
    const currentSize = Number(row.current_size ?? 0);

    // Classification
    let trendLabel = "stable";
    if (daysSinceFirstSeen <= 14 && currentSize >= 3) {
      trendLabel = "new_signal";
      newSignalsCount++;
    } else if (daysSinceFirstSeen <= 30 && currentSize >= 5) {
      trendLabel = "emerging";
    } else if (acceleration > 0.2) {
      trendLabel = "growing";
      growingCount++;
    } else if (acceleration < -0.1) {
      trendLabel = "declining";
    }

    // Fetch sample insights
    const sampleRows = await db.execute(sql`
      SELECT details_json, created_at
      FROM meeting_insights
      WHERE cluster_id = ${String(row.id)}
      ORDER BY created_at DESC
      LIMIT 3
    `);

    const sampleInsights = (sampleRows as unknown as Array<{ details_json: unknown; created_at: unknown }>).map((s) => {
      const details = insightPromptRecord(s.details_json as Record<string, unknown> | null);
      return {
        evidence: `${details.title} - ${details.summary}`,
        timestamp: s.created_at ? String(s.created_at) : null,
      };
    });

    trends.push({
      id: String(row.id),
      name: row.name ? String(row.name) : null,
      description: row.description ? String(row.description) : null,
      type: row.type ? String(row.type) : null,
      is_seeded: Boolean(row.is_seeded),
      first_seen_at: row.first_seen_at ? new Date(row.first_seen_at as string) : null,
      current_size: currentSize,
      mentions_7d: mentions7d,
      mentions_30d: mentions30d,
      mentions_prev_30d: mentionsPrev30d,
      velocity: Math.round(velocity * 100) / 100,
      acceleration: Math.round(acceleration * 100) / 100,
      trend_label: trendLabel,
      sample_insights: sampleInsights,
    });
  }

  // Sort: new_signal first, then growing, then by mentions
  trends.sort((a, b) => {
    const pa = TREND_PRIORITY[a.trend_label] ?? 5;
    const pb = TREND_PRIORITY[b.trend_label] ?? 5;
    if (pa !== pb) return pa - pb;
    return b.mentions_30d - a.mentions_30d;
  });

  const topTrend = trends.length > 0 ? trends[0].name : null;
  const fastest = trends.length > 0
    ? trends.reduce((best, t) => (t.acceleration > best.acceleration ? t : best))
    : null;
  const fastestGrowing = fastest && fastest.acceleration > 0 ? fastest.name : null;

  const summary: TrendsSummary = {
    total_clusters: totalClusters,
    total_insights_30d: totalInsights30d,
    new_signals_count: newSignalsCount,
    growing_count: growingCount,
    top_trend: topTrend,
    fastest_growing: fastestGrowing,
  };

  return { trends, summary };
}
