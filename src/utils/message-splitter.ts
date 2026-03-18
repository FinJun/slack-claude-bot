const MAX_CHUNK_SIZE = 3900;

interface SplitOptions {
  maxSize?: number;
}

/**
 * Splits a message into chunks of at most maxSize characters,
 * preserving code blocks (```...```) so they are not split mid-block.
 */
export function splitMessage(text: string, options: SplitOptions = {}): string[] {
  const maxSize = options.maxSize ?? MAX_CHUNK_SIZE;

  if (text.length <= maxSize) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxSize) {
      chunks.push(remaining);
      break;
    }

    const chunk = findSplitPoint(remaining, maxSize);
    chunks.push(chunk);
    remaining = remaining.slice(chunk.length);
  }

  return chunks;
}

/**
 * Finds a safe split point that:
 * 1. Does not exceed maxSize
 * 2. Does not split inside a code block
 * 3. Prefers splitting at newlines
 */
function findSplitPoint(text: string, maxSize: number): string {
  // Check if we're inside a code block at the split boundary
  const candidateEnd = maxSize;
  const candidate = text.slice(0, candidateEnd);

  // Count ``` occurrences up to the candidate end
  // If odd, we're inside a code block
  if (isInsideCodeBlock(text, candidateEnd)) {
    // Find the closing ``` before maxSize
    const closeIdx = findCodeBlockClose(text, candidateEnd);
    if (closeIdx !== -1 && closeIdx <= maxSize) {
      // Split after the closing ```
      const newline = text.indexOf('\n', closeIdx + 3);
      const splitAt = newline !== -1 && newline <= maxSize ? newline + 1 : closeIdx + 3;
      return text.slice(0, splitAt);
    }

    // Can't fit the entire code block; split at a newline before the code block opens
    const openIdx = findLastCodeBlockOpen(text, candidateEnd);
    if (openIdx > 0) {
      const newline = text.lastIndexOf('\n', openIdx - 1);
      if (newline > 0) {
        return text.slice(0, newline + 1);
      }
    }

    // Fallback: hard split
    return candidate;
  }

  // Not inside a code block — prefer splitting at a newline
  const lastNewline = candidate.lastIndexOf('\n');
  if (lastNewline > maxSize / 2) {
    return text.slice(0, lastNewline + 1);
  }

  return candidate;
}

function isInsideCodeBlock(text: string, position: number): boolean {
  const slice = text.slice(0, position);
  let count = 0;
  let idx = 0;
  while (idx < slice.length) {
    if (slice.startsWith('```', idx)) {
      count++;
      idx += 3;
    } else {
      idx++;
    }
  }
  return count % 2 !== 0;
}

function findCodeBlockClose(text: string, searchBefore: number): number {
  // Find the position of the opening ``` that is currently unclosed
  let openIdx = -1;
  let count = 0;
  let idx = 0;
  while (idx < searchBefore) {
    if (text.startsWith('```', idx)) {
      count++;
      if (count % 2 !== 0) {
        openIdx = idx;
      }
      idx += 3;
    } else {
      idx++;
    }
  }

  if (openIdx === -1) return -1;

  // Now find the closing ``` after openIdx
  let closeIdx = openIdx + 3;
  while (closeIdx < text.length) {
    if (text.startsWith('```', closeIdx)) {
      return closeIdx;
    }
    closeIdx++;
  }

  return -1;
}

function findLastCodeBlockOpen(text: string, searchBefore: number): number {
  let openIdx = -1;
  let count = 0;
  let idx = 0;
  while (idx < searchBefore) {
    if (text.startsWith('```', idx)) {
      count++;
      if (count % 2 !== 0) {
        openIdx = idx;
      }
      idx += 3;
    } else {
      idx++;
    }
  }
  return openIdx;
}
