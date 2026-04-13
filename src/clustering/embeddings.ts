/**
 * Embedding generation via OpenAI text-embedding-3-large (3072 dimensions).
 * Uses the Vercel AI SDK already present in arali-mastra.
 */

import { openai } from "@ai-sdk/openai";
import { embedMany } from "ai";
import { EMBEDDING_DIMENSION } from "./types.js";

const EMBEDDING_MODEL = "text-embedding-3-large";
const MAX_BATCH_SIZE = 256; // OpenAI API limit per request

/**
 * Embed a list of texts into 3072-dim vectors.
 * Automatically chunks into batches if needed.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // Filter empty strings — OpenAI rejects them
  const validIndices: number[] = [];
  const validTexts: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    if (texts[i]?.trim()) {
      validIndices.push(i);
      validTexts.push(texts[i]);
    }
  }

  if (validTexts.length === 0) {
    return texts.map(() => new Array<number>(EMBEDDING_DIMENSION).fill(0));
  }

  // Batch embed
  const allEmbeddings: number[][] = [];
  for (let start = 0; start < validTexts.length; start += MAX_BATCH_SIZE) {
    const batch = validTexts.slice(start, start + MAX_BATCH_SIZE);
    const { embeddings } = await embedMany({
      model: openai.embedding(EMBEDDING_MODEL),
      values: batch,
    });
    allEmbeddings.push(...embeddings);
  }

  // Reconstruct the result array matching original order
  const result: number[][] = texts.map(
    () => new Array<number>(EMBEDDING_DIMENSION).fill(0),
  );
  for (let i = 0; i < validIndices.length; i++) {
    result[validIndices[i]] = allEmbeddings[i];
  }

  return result;
}
