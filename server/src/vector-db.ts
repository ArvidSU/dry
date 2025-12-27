import Redis from 'ioredis';
import { EmbeddingIndex, Config } from './types';

export class VectorDb {
  private redis: Redis;

  constructor(private config: Config) {
    this.redis = new Redis(this.config.valkeyUrl);
  }

  /**
   * Stores an embedding and its metadata in Valkey.
   * @param index The embedding index to store
   */
  async storeEmbedding(index: EmbeddingIndex): Promise<void> {
    await this.redis.hset(`element:${index.id}`, {
      data: JSON.stringify(index.elementData),
      embedding: JSON.stringify(index.embedding),
    });
    // Add ID to a set for tracking all indexed elements
    await this.redis.sadd('elements:ids', index.id);
  }

  /**
   * Stores multiple embeddings and their metadata in Valkey using a pipeline.
   * @param indices Array of embedding indices to store
   */
  async storeEmbeddings(indices: EmbeddingIndex[]): Promise<void> {
    const pipeline = this.redis.pipeline();
    for (const index of indices) {
      pipeline.hset(`element:${index.id}`, {
        data: JSON.stringify(index.elementData),
        embedding: JSON.stringify(index.embedding),
      });
      pipeline.sadd('elements:ids', index.id);
    }
    await pipeline.exec();
  }

  /**
   * Retrieves an embedding index by its ID.
   * @param id The element ID
   * @returns The embedding index or null if not found
   */
  async getEmbedding(id: string): Promise<EmbeddingIndex | null> {
    const data = await this.redis.hgetall(`element:${id}`);
    if (!data || Object.keys(data).length === 0) {
      return null;
    }

    return {
      id,
      elementData: JSON.parse(data.data),
      embedding: JSON.parse(data.embedding),
    };
  }

  /**
   * Retrieves all stored embeddings.
   * Note: In a production environment with many elements, 
   * this should use Valkey's native vector search capabilities.
   * @returns Array of all embedding indices
   */
  async getAllEmbeddings(): Promise<EmbeddingIndex[]> {
    const ids = await this.redis.smembers('elements:ids');
    const pipelines = this.redis.pipeline();
    
    for (const id of ids) {
      pipelines.hgetall(`element:${id}`);
    }

    const results = await pipelines.exec();
    if (!results) return [];

    const embeddingIndices: EmbeddingIndex[] = [];
    for (let i = 0; i < ids.length; i++) {
      const [err, data] = results[i] as [Error | null, any];
      if (err || !data || Object.keys(data).length === 0) continue;
      
      embeddingIndices.push({
        id: ids[i],
        elementData: JSON.parse(data.data),
        embedding: JSON.parse(data.embedding),
      });
    }

    return embeddingIndices;
  }

  /**
   * Deletes all stored embeddings and metadata from Valkey.
   * @returns The number of elements deleted
   */
  async deleteAllEmbeddings(): Promise<number> {
    const ids = await this.redis.smembers('elements:ids');
    if (ids.length === 0) return 0;

    const pipeline = this.redis.pipeline();
    for (const id of ids) {
      pipeline.del(`element:${id}`);
    }
    pipeline.del('elements:ids');

    await pipeline.exec();
    return ids.length;
  }

  /**
   * Retrieves multiple cached embeddings in a single batch.
   */
  async getBatchCachedEmbeddings(keys: { fileHash: string, elementName: string, lineNumber: number }[]): Promise<(number[] | null)[]> {
    if (keys.length === 0) return [];
    
    const redisKeys = keys.map(k => `embedding_cache:${k.fileHash}:${k.elementName}:${k.lineNumber}`);
    const results = await this.redis.mget(...redisKeys);
    
    return results.map((r: string | null) => r ? JSON.parse(r) : null);
  }

  /**
   * Caches multiple embeddings in a single batch using a pipeline.
   * Cache expires in 7 days.
   */
  async cacheEmbeddings(entries: { fileHash: string, elementName: string, lineNumber: number, embedding: number[] }[]): Promise<void> {
    if (entries.length === 0) return;

    const pipeline = this.redis.pipeline();
    for (const entry of entries) {
      const key = `embedding_cache:${entry.fileHash}:${entry.elementName}:${entry.lineNumber}`;
      pipeline.set(key, JSON.stringify(entry.embedding), 'EX', 60 * 60 * 24 * 7);
    }
    await pipeline.exec();
  }

  /**
   * Retrieves a cached embedding for a given file hash, element name, and line number.
   */
  async getCachedEmbedding(fileHash: string, elementName: string, lineNumber: number): Promise<number[] | null> {
    const key = `embedding_cache:${fileHash}:${elementName}:${lineNumber}`;
    const cached = await this.redis.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  /**
   * Caches an embedding for a given file hash, element name, and line number.
   * Cache expires in 7 days.
   */
  async cacheEmbedding(fileHash: string, elementName: string, lineNumber: number, embedding: number[]): Promise<void> {
    const key = `embedding_cache:${fileHash}:${elementName}:${lineNumber}`;
    await this.redis.set(key, JSON.stringify(embedding), 'EX', 60 * 60 * 24 * 7);
  }
}

