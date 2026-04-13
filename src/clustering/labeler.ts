/**
 * LLM-backed cluster labeling via OpenRouter.
 * Port of arali-python ClusterLabeler.
 */

import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";
import { z } from "zod";
import type { LabelPayload, LabelResult } from "./types.js";

const LABELER_MODEL = process.env.LABELER_MODEL ?? "google/gemini-2.5-flash-lite";

const LabelSchema = z.object({
  name: z.string(),
  description: z.string(),
  type: z.string().optional().default(""),
});

// ---------------------------------------------------------------------------
// System prompts per metric_key
// ---------------------------------------------------------------------------

const SYSTEM_PROMPTS: Record<string, string> = {
  objections_handling: `You are a product manager analyzing sales objections.

OUTPUT FORMAT (strict JSON):
{
  "name": "5-8 word objection theme",
  "description": "30-50 word summary",
  "type": "one of the valid types"
}

TITLE RULES:
- State the core concern directly (e.g., 'Price too high for small dealerships')
- Avoid vague labels like 'concerns' or 'issues'
- Should read like a complaint, not a category
- Bad: 'Pricing Concerns' | Good: 'Monthly cost exceeds budget for tier-2 dealers'

DESCRIPTION RULES:
- Summarize the most common objection patterns
- Include frequency if multiple variations exist
- 30-50 words exactly
- Be specific about the pain point

VALID TYPES (choose exactly one):
- pricing: Cost, ROI, or budget concerns
- product: Missing features or functionality gaps
- timing: 'Not now' or seasonal concerns
- need: Questioning necessity or fit
- integrations: Technical compatibility issues
- trust: Credibility, security, or vendor concerns
- value: Unclear differentiation or benefits
- authority: Decision-maker not involved
- support: Training, onboarding, or service worries
- legal: Compliance, contracts, or legal blockers`,

  competitor_mentions: `You are a competitive intelligence analyst.

OUTPUT FORMAT (strict JSON):
{
  "name": "Competitor Name",
  "description": "30-50 word summary of why they are mentioned",
  "type": "Competitor Reference"
}

TITLE RULES:
- Use the canonical competitor name found in the insights
- Keep it simple (e.g., 'CarCutter', 'Impel')

DESCRIPTION RULES:
- Explain WHY the user mentioned this competitor
- Examples: 'Used for pricing comparison', 'Current provider being replaced', 'Lacks feature X', 'Better at Y'
- Summarize the context of the mentions
- 30-50 words exactly

VALID TYPES:
- Competitor Reference`,
};

const DEFAULT_SYSTEM_PROMPT = `You are a product manager analyzing customer feature requests.

OUTPUT FORMAT (strict JSON):
{
  "name": "8-10 word feature name",
  "description": "30-50 word description",
  "type": "one of the valid types"
}

TITLE RULES:
- Start with a verb or action (e.g., 'Auto-generate', 'Convert', 'Enable')
- Be specific about what it does, not what it is
- Avoid buzzwords: no 'AI-powered', 'enhanced', 'optimization'
- Must be scannable - meaning clear in 2 seconds
- Bad: 'AI Virtual Studio Enhancement' | Good: 'Replace vehicle backgrounds with studio scenes'

DESCRIPTION RULES:
- Explain the user outcome, not the technology
- Include: what triggers it, what it produces, why it matters
- 30-50 words exactly
- No marketing fluff

VALID TYPES (choose exactly one):
- Adoption: New feature or capability being added
- Integrations: Connects with external tools/platforms
- Analytics: Data, reporting, or insights features
- UI/UX: Interface improvements or usability changes
- Configuration: Settings, customization, or setup features
- Access Control: Permissions, roles, or security features
- Competitor Reference: Feature parity or competitive response`;

// ---------------------------------------------------------------------------
// Keyword-based fallback (no API key)
// ---------------------------------------------------------------------------

const KEYWORD_MAP: Record<string, string[]> = {
  Adoption: ["adoption", "usage", "rollout"],
  Integrations: ["integration", "api", "crm"],
  Analytics: ["dashboard", "report", "analytics"],
  "UI/UX": ["ui", "ux", "interface", "design"],
  Configuration: ["config", "setting", "workflow"],
  "Access Control": ["permission", "role", "access"],
  "Competitor Reference": ["competitor", "alternative", "vs"],
  Pricing: ["price", "cost", "budget", "expensive"],
  Timing: ["timing", "later", "roadmap", "q1", "q2", "q3", "q4"],
  Authority: ["decision", "manager", "boss", "approval"],
  Need: ["need", "requirement", "gap", "missing"],
  Competition: ["competitor", "other tool", "switch"],
};

function detectType(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [typeName, keywords] of Object.entries(KEYWORD_MAP)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return typeName;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main labeler
// ---------------------------------------------------------------------------

export async function labelCluster(payload: LabelPayload): Promise<LabelResult> {
  const { insights, metric_key } = payload;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    // Rule-based fallback
    const text = insights
      .map((i) => `${i.title} ${i.summary}`)
      .join(" ")
      .toLowerCase();
    return {
      name: insights[0]?.title.slice(0, 60) ?? "Cluster",
      description:
        insights
          .map((i) => i.summary)
          .filter(Boolean)
          .join(" ")
          .trim() || "Cluster generated from feature feedback.",
      type: detectType(text),
    };
  }

  const systemPrompt = SYSTEM_PROMPTS[metric_key] ?? DEFAULT_SYSTEM_PROMPT;

  const userPromptLines = [
    "Cluster context:",
    `enterprise_id: ${payload.enterprise_id}`,
    `metric_key: ${metric_key}`,
    "",
    "Insights (title + summary):",
  ];
  for (let i = 0; i < insights.length; i++) {
    userPromptLines.push(`${i + 1}) Title: "${insights[i].title}"`);
    userPromptLines.push(`   Summary: "${insights[i].summary}"`);
    userPromptLines.push("");
  }
  userPromptLines.push("Return strict JSON with keys name, description, type.");

  const openrouter = createOpenRouter({
    apiKey,
    appName: "arali-clustering",
    appUrl: "https://arali.ai",
  });

  const { object } = await generateObject({
    model: openrouter(LABELER_MODEL),
    schema: LabelSchema,
    system: systemPrompt,
    prompt: userPromptLines.join("\n"),
    temperature: 0,
  });

  return {
    name: object.name.trim(),
    description: object.description.trim(),
    type: object.type?.trim() || null,
  };
}
