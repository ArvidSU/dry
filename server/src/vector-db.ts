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
}

