import { expect, test, describe, mock } from "bun:test";
import { DryClient } from "./client";

mock.module("undici", () => ({
  fetch: async (url: string, options: any) => {
    if (url.includes("/elements") && options.method === "POST") {
      return {
        ok: true,
        json: async () => ({ id: "test-id" }),
      };
    }
    if (url.includes("/similar/test-id")) {
      return {
        ok: true,
        json: async () => ({
          similarElements: [
            {
              metadata: { filePath: "other.ts", lineNumber: 10, elementName: "otherFunc" },
              elementString: "function otherFunc() {}",
            },
          ],
        }),
      };
    }
    return { ok: false, status: 404, text: async () => "Not Found" };
  },
}));

describe("DryClient", () => {
  const client = new DryClient("http://localhost:3000");

  test("submitElement should return an ID", async () => {
    const id = await client.submitElement({
      metadata: { filePath: "test.ts", lineNumber: 1, elementName: "testFunc" },
      elementString: "function testFunc() {}",
    });
    expect(id).toBe("test-id");
  });

  test("findSimilar should return similar elements", async () => {
    const similar = await client.findSimilar("test-id", 0.9);
    expect(similar.length).toBe(1);
    expect(similar[0].metadata.elementName).toBe("otherFunc");
  });
});

