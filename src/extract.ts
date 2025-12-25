import fs from 'fs';
import { ElementData } from './types';

/**
 * Checks if a given position in the content is inside a comment.
 * Handles both single-line (//) and multi-line (/* *\/) comments.
 */
function isInsideComment(content: string, position: number): boolean {
  // Find the start of the line containing this position
  let lineStart = position;
  while (lineStart > 0 && content[lineStart - 1] !== '\n') {
    lineStart--;
  }

  // Check for single-line comment (//) on this line before the position
  const lineContent = content.substring(lineStart, position);
  if (lineContent.includes('//')) {
    return true;
  }

  // Check for multi-line comments (/* ... */)
  // Find the last /* before this position
  let lastCommentStart = -1;
  for (let i = position - 1; i >= 0; i--) {
    if (i > 0 && content[i - 1] === '/' && content[i] === '*') {
      lastCommentStart = i - 1;
      break;
    }
  }

  if (lastCommentStart === -1) {
    return false; // No multi-line comment starts before this position
  }

  // Check if this comment has been closed before the position
  for (let i = lastCommentStart + 2; i < position; i++) {
    if (i < content.length - 1 && content[i] === '*' && content[i + 1] === '/') {
      return false; // Comment was closed before this position
    }
  }

  return true; // We're inside an unclosed multi-line comment
}

/**
 * Extracts elements from a file based on an array of signature regexes.
 * It finds the signature and then captures the element body by balancing braces.
 * 
 * @param filePath Path to the file to parse
 * @param includeRegexes Array of regexes to match the element signature. 
 *                        If it has a capture group, the first one is used as element name.
 * @param excludeRegexes Array of regexes to exclude matching signatures.
 * @returns Array of extracted elements with metadata
 */
export function extractElements(
  filePath: string, 
  includeRegexes: RegExp[], 
  excludeRegexes: RegExp[] = []
): ElementData[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const elements: ElementData[] = [];
  const seenPositions = new Set<number>();

  for (const signatureRegex of includeRegexes) {
    // Ensure global flag for matchAll
    const regex = new RegExp(signatureRegex.source, signatureRegex.flags.includes('g') ? signatureRegex.flags : signatureRegex.flags + 'g');
    
    const matches = [...content.matchAll(regex)];

    for (const match of matches) {
      const signature = match[0];

      // Skip if the signature matches any exclude pattern
      if (excludeRegexes.some(excludeRegex => excludeRegex.test(signature))) {
        continue;
      }

      const startIndex = match.index!;
      const elementName = match[1] || signature.trim();

      // Skip if we've already extracted an element starting at this position
      if (seenPositions.has(startIndex)) {
        continue;
      }

      // Skip matches that are inside comments
      if (isInsideComment(content, startIndex)) {
        continue;
      }

      // Calculate line number
      const beforeMatch = content.substring(0, startIndex);
      const lineNumber = beforeMatch.split('\n').length;

      // Find the opening brace of the element body
      let bodyStartIndex = -1;
      for (let i = startIndex + signature.length; i < content.length; i++) {
        if (content[i] === '{') {
          bodyStartIndex = i;
          break;
        }
        // If we hit another signature or something that looks like it's not an element body
        // we might want to stop, but for now we'll assume the signature is followed by {
        if (content[i] === ';' || (content[i] === '}' && i > startIndex + signature.length)) {
            // Likely a declaration without body or something else
            break;
        }
      }

      if (bodyStartIndex === -1) continue;

      // Extract body by balancing braces starting from bodyStartIndex
      let braceCount = 0;
      let bodyEndIndex = -1;

      for (let i = bodyStartIndex; i < content.length; i++) {
        const char = content[i];
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
        }

        if (braceCount === 0) {
          bodyEndIndex = i + 1;
          break;
        }
      }

      if (bodyEndIndex !== -1) {
        const elementString = content.substring(startIndex, bodyEndIndex);
        elements.push({
          metadata: {
            filePath,
            lineNumber,
            elementName,
          },
          elementString,
        });
        seenPositions.add(startIndex);
      }
    }
  }

  return elements;
}

