import { fetch } from 'undici';
import { ElementData, SubmitElementResponse, SimilarElementsResponse, SimilarPairsResponse, SimilarPair, SearchResult, SearchResponse } from './types';

export class DryClient {
  private serverUrl: string;

  constructor(serverUrl?: string) {
    const url = serverUrl || process.env.DRY_SERVER_URL || 'http://localhost:3000';
    this.serverUrl = url.endsWith('/') ? url.slice(0, -1) : url;
  }

  /**
   * Submits an element to the server for indexing.
   * @param elementData The element code and metadata
   * @returns The ID of the indexed element
   */
  async submitElement(elementData: ElementData): Promise<string> {
    const response = await fetch(`${this.serverUrl}/elements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(elementData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to submit element (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as SubmitElementResponse;
    return data.id;
  }

  /**
   * Deletes all elements from the server.
   * @returns The number of deleted elements
   */
  async wipeAllElements(): Promise<number> {
    const response = await fetch(`${this.serverUrl}/elements`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to wipe elements (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as { success: boolean; deletedCount: number };
    return data.deletedCount;
  }

  /**
   * Finds similar elements based on an element ID.
   * @param id The ID of the element to compare against
   * @param threshold Cosine similarity threshold (0-1)
   * @param limit Maximum number of results to return
   * @returns Array of similar elements
   */
  async findSimilar(id: string, threshold: number = 0.8, limit: number = 10): Promise<ElementData[]> {
    const params = new URLSearchParams({
      threshold: threshold.toString(),
      limit: limit.toString(),
    });

    const response = await fetch(`${this.serverUrl}/similar/${id}?${params.toString()}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to find similar elements (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as SimilarElementsResponse;
    return data.similarElements;
  }

  /**
   * Finds the most similar element pairs across all indexed elements.
   * @param threshold Cosine similarity threshold (0-1)
   * @param limit Maximum number of pairs to return
   * @returns Array of similar element pairs with their similarity scores
   */
  async findMostSimilarPairs(threshold: number = 0.8, limit: number = 10): Promise<SimilarPair[]> {
    const params = new URLSearchParams({
      threshold: threshold.toString(),
      limit: limit.toString(),
    });

    const response = await fetch(`${this.serverUrl}/similar/all?${params.toString()}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to find most similar pairs (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as SimilarPairsResponse;
    return data.pairs;
  }

  /**
   * Performs a semantic search for code elements.
   * @param query The search query string
   * @param threshold Cosine similarity threshold (0-1)
   * @param limit Maximum number of results to return
   * @returns Array of search results with similarity scores
   */
  async search(query: string, threshold: number = 0.8, limit: number = 10): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      q: query,
      threshold: threshold.toString(),
      limit: limit.toString(),
    });

    const response = await fetch(`${this.serverUrl}/search?${params.toString()}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to perform semantic search (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as SearchResponse;
    return data.results;
  }
}

