import { expect, test, describe, mock } from "bun:test";
import { SimilarityService } from "./similarity";
import { VectorDb } from "./vector-db";

describe("SimilarityService", () => {
  const mockVectorDb = {
    getEmbedding: async (id: string) => {
      if (id === "1") return { id: "1", embedding: [1, 0], elementData: { metadata: { elementName: "A" } } as any };
      return null;
    },
    getAllEmbeddings: async () => [
      { id: "1", embedding: [1, 0], elementData: { metadata: { elementName: "A" } } as any },
      { id: "2", embedding: [0.9, 0.1], elementData: { metadata: { elementName: "B" } } as any },
      { id: "3", embedding: [0, 1], elementData: { metadata: { elementName: "C" } } as any },
    ],
  } as unknown as VectorDb;

  const service = new SimilarityService(mockVectorDb);

  test("findSimilar should return elements above threshold", async () => {
    const results = await service.findSimilar("1", 0.8, 10);
    expect(results.length).toBe(1);
    expect(results[0].metadata.elementName).toBe("B");
  });

  test("findMostSimilarPairs should return pairs above threshold", async () => {
    const pairs = await service.findMostSimilarPairs(0.8, 10);
    expect(pairs.length).toBe(1);
    expect(pairs[0].element1.metadata.elementName).toBe("A");
    expect(pairs[0].element2.metadata.elementName).toBe("B");
    expect(pairs[0].similarity).toBeGreaterThan(0.8);
  });
});

