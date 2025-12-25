import { expect, test, describe, mock } from "bun:test";
import { extractElements } from "./extract";

// Mock fs.readFileSync
mock.module("fs", () => ({
  default: {
    readFileSync: (path: string) => {
      if (path === "test.ts") {
        return `
// A function here
function hello() {
  console.log("hello");
}

/* Another function
   below */
function world() {
  const x = { a: 1 };
  if (x) {
    console.log("world");
  }
}

// function commentedOut() {
//   void 0;
// }

/*
function commentedOut2() {
  void 0;
}
*/

const arrow = () => {
  return "arrow";
};
        `;
      }
      return "";
    },
  },
}));

describe("extractElements", () => {
  const regexes = [/function\s+(\w+)/, /const\s+(\w+)\s*=\s*\(\)\s*=>/];

  test("should extract standard functions", () => {
    const elements = extractElements("test.ts", regexes);
    
    const names = elements.map(e => e.metadata.elementName);
    expect(names).toContain("hello");
    expect(names).toContain("world");
    expect(names).toContain("arrow");
  });

  test("should ignore commented out functions", () => {
    const elements = extractElements("test.ts", regexes);
    
    const names = elements.map(e => e.metadata.elementName);
    expect(names).not.toContain("commentedOut");
    expect(names).not.toContain("commentedOut2");
  });

  test("should correctly balance braces with nested objects", () => {
    const elements = extractElements("test.ts", regexes);
    const world = elements.find(e => e.metadata.elementName === "world");
    
    expect(world?.elementString).toContain("const x = { a: 1 };");
    expect(world?.elementString).toContain("console.log(\"world\");");
    expect(world?.elementString.trim().endsWith("}")).toBe(true);
  });

  test("should capture correct line numbers", () => {
    const elements = extractElements("test.ts", regexes);
    
    const hello = elements.find(e => e.metadata.elementName === "hello");
    expect(hello?.metadata.lineNumber).toBe(3);

    const world = elements.find(e => e.metadata.elementName === "world");
    expect(world?.metadata.lineNumber).toBe(9);
  });
});
