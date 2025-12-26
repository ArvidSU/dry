import { ElementData, EmbeddingIndex, SearchResult } from './types';
import { VectorDb } from './vector-db';

/**
 * Calculates the cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let mA = 0;
  let mB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    mA += a[i] * a[i];
    mB += b[i] * b[i];
  }
  
  mA = Math.sqrt(mA);
  mB = Math.sqrt(mB);
  
  if (mA === 0 || mB === 0) return 0;
  
  return dotProduct / (mA * mB);
}

export class SimilarityService {
  constructor(private vectorDb: VectorDb) {}

  /**
   * Finds elements similar to the one specified by ID.
   * @param id The ID of the element to compare
   * @param threshold Minimum cosine similarity (0-1)
   * @param limit Maximum number of results
   * @returns Array of similar elements
   */
  async findSimilar(id: string, threshold: number, limit: number): Promise<ElementData[]> {
    const target = await this.vectorDb.getEmbedding(id);
    if (!target) {
      throw new Error(`Element with ID ${id} not found`);
    }

    const allIndices = await this.vectorDb.getAllEmbeddings();
    
    // Calculate similarities, filter by threshold, sort by similarity, and limit results
    const results = allIndices
      .filter(item => item.id !== id) // Don't compare with itself
      .map(item => ({
        elementData: item.elementData,
        similarity: cosineSimilarity(target.embedding, item.embedding)
      }))
      .filter(item => item.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .map(item => item.elementData);

    return results;
  }

  /**
   * Finds the most similar element pairs across all elements.
   * @param threshold Minimum cosine similarity (0-1)
   * @param limit Maximum number of pairs to return
   * @returns Array of similar element pairs with their similarity scores
   */
  async findMostSimilarPairs(threshold: number, limit: number): Promise<Array<{
    element1: ElementData;
    element2: ElementData;
    similarity: number;
  }>> {
    const allIndices = await this.vectorDb.getAllEmbeddings();
    
    if (allIndices.length < 2) {
      return [];
    }

    const pairs: Array<{
      element1: ElementData;
      element2: ElementData;
      similarity: number;
    }> = [];

    // Compare all pairs (avoiding duplicates)
    for (let i = 0; i < allIndices.length; i++) {
      for (let j = i + 1; j < allIndices.length; j++) {
        const similarity = cosineSimilarity(allIndices[i].embedding, allIndices[j].embedding);
        if (similarity >= threshold) {
          pairs.push({
            element1: allIndices[i].elementData,
            element2: allIndices[j].elementData,
            similarity,
          });
        }
      }
    }

    // Sort by similarity (highest first) and limit results
    return pairs
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Searches for elements similar to a given query embedding.
   * @param queryEmbedding The embedding vector to search for
   * @param threshold Minimum cosine similarity (0-1)
   * @param limit Maximum number of results
   * @returns Array of search results with similarity scores
   */
  async searchByVector(queryEmbedding: number[], threshold: number, limit: number): Promise<SearchResult[]> {
    const allIndices = await this.vectorDb.getAllEmbeddings();
    
    return allIndices
      .map(item => ({
        element: item.elementData,
        similarity: cosineSimilarity(queryEmbedding, item.embedding)
      }))
      .filter(item => item.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }
}

