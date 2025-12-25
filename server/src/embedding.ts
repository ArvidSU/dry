import { fetch } from 'undici';
import { Config } from './types';

export class EmbeddingService {
  constructor(private config: Config) {}

  /**
   * Creates an embedding for the given text using an OpenAI-compatible API.
   * @param text The element string to embed
   * @returns The embedding vector
   */
  async createEmbedding(text: string): Promise<number[]> {
    if (!this.config.embeddingApiUrl) {
      throw new Error('EMBEDDING_API_URL is not configured');
    }

    const response = await fetch(this.config.embeddingApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.embeddingApiKey ? { 'Authorization': `Bearer ${this.config.embeddingApiKey}` } : {}),
      },
      body: JSON.stringify({
        input: text,
        // Check EMBEDDING_MODEL first (manual override), then EMBEDDINGGEMMA_MODEL (Compose-injected), then default
        model: process.env.EMBEDDING_MODEL || process.env.EMBEDDINGGEMMA_MODEL || 'text-embedding-3-small',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Embedding API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as any;
    
    if (!data.data || !data.data[0] || !data.data[0].embedding) {
      throw new Error('Invalid response format from embedding API');
    }

    return data.data[0].embedding;
  }
}

