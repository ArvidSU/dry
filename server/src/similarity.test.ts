import { expect, test, describe } from "bun:test";
import { cosineSimilarity } from "./similarity";

describe("cosineSimilarity", () => {
  test("should return 1 for identical vectors", () => {
    const a = [1, 2, 3];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  test("should return 0 for orthogonal vectors", () => {
    const a = [1, 0];
    const b = [0, 1];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  test("should return correct similarity for known vectors", () => {
    const a = [1, 1]; // 45 degrees
    const b = [1, 0]; // 0 degrees
    // cos(45) = 1/sqrt(2) approx 0.7071
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.707106, 5);
  });

  test("should handle different magnitudes", () => {
    const a = [1, 2, 3];
    const b = [2, 4, 6];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  test("should return 0 for different length vectors", () => {
    const a = [1, 2];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  test("should return 0 if one vector is all zeros", () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

