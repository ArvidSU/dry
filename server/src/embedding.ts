import { fetch } from 'undici';
import { Config } from './types';

export class EmbeddingService {
  constructor(private config: Config) {}

  /**
   * Creates an embedding for the given text using an OpenAI-compatible API.
   * If the text is too large, it splits it into chunks and averages the resulting embeddings.
   * @param text The element string to embed
   * @returns The embedding vector
   */
  async createEmbedding(text: string): Promise<number[]> {
    if (!this.config.embeddingApiUrl) {
      throw new Error('EMBEDDING_API_URL is not configured');
    }

    const chunks = this.splitIntoChunks(text);
    const embeddings: number[][] = [];

    for (const chunk of chunks) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

      try {
        const response = await fetch(this.config.embeddingApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.embeddingApiKey ? { 'Authorization': `Bearer ${this.config.embeddingApiKey}` } : {}),
          },
          body: JSON.stringify({
            input: chunk,
            // Check EMBEDDING_MODEL first (manual override), then EMBEDDINGGEMMA_MODEL (Compose-injected), then default
            model: process.env.EMBEDDING_MODEL || process.env.EMBEDDINGGEMMA_MODEL || 'text-embedding-3-small',
          }),
          signal: controller.signal as any,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Embedding API error (${response.status}): ${errorText}`);
        }

        const data = (await response.json()) as any;
        
        if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
          throw new Error('Invalid response format from embedding API');
        }

        embeddings.push(data.data[0].embedding);
      } finally {
        clearTimeout(timeout);
      }
    }
    
    if (embeddings.length === 1) {
      return embeddings[0];
    }

    return this.averageEmbeddings(embeddings);
  }

  /**
   * Creates embeddings for multiple texts in parallel.
   * @param texts Array of element strings to embed
   * @returns Array of embedding vectors
   */
  async createEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.config.embeddingApiUrl) {
      throw new Error('EMBEDDING_API_URL is not configured');
    }

    // Process texts with limited concurrency to avoid overloading the API or hitting pool limits.
    const concurrencyLimit = 5;
    const results: number[][] = new Array(texts.length);
    const queue = texts.map((text, index) => ({ text, index }));
    
    const workers = Array.from({ length: Math.min(concurrencyLimit, texts.length) }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        results[item.index] = await this.createEmbedding(item.text);
      }
    });

    await Promise.all(workers);
    return results;
  }

  /**
   * Splits a string into chunks based on the configured chunk size.
   * Tries to split at line breaks to preserve context.
   */
  private splitIntoChunks(text: string): string[] {
    const limit = Math.max(100, this.config.embeddingChunkSize || 1000);
    if (text.length <= limit) {
      return [text];
    }

    const chunks: string[] = [];
    const lines = text.split('\n');
    let currentChunk = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] + (i < lines.length - 1 ? '\n' : '');
      
      // If a single line is longer than the limit, we have to split it forcefully
      if (line.length > limit) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        
        let remainingLine = line;
        while (remainingLine.length > limit) {
          chunks.push(remainingLine.slice(0, limit));
          remainingLine = remainingLine.slice(limit);
        }
        currentChunk = remainingLine;
        continue;
      }

      if (currentChunk.length + line.length > limit) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = line;
      } else {
        currentChunk += line;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks.filter(c => c.length > 0);
  }

  /**
   * Averages multiple embedding vectors into a single vector.
   */
  private averageEmbeddings(embeddings: number[][]): number[] {
    if (embeddings.length === 0) return [];
    
    const vectorLength = embeddings[0].length;
    const averaged = new Array(vectorLength).fill(0);

    for (const embedding of embeddings) {
      for (let i = 0; i < vectorLength; i++) {
        averaged[i] += embedding[i];
      }
    }

    for (let i = 0; i < vectorLength; i++) {
      averaged[i] /= embeddings.length;
    }

    return averaged;
  }
}

