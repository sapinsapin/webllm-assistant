/**
 * Incremental parser for OpenAI-style SSE chat streams
 * (`data: {"choices":[{"delta":{"content":"..."}}]}` lines, `data: [DONE]`).
 *
 * Rules:
 * - Only complete (newline-terminated) lines are parsed; the unterminated tail
 *   stays buffered until more data arrives (handles JSON split across chunks).
 * - A complete line that is not valid JSON is malformed — it is skipped, not
 *   retried, so one bad event can never stall the rest of the stream.
 * - `flush()` drains whatever terminated-or-not data remains at stream end.
 */
export function createSseParser() {
  let buffer = "";

  const parseLine = (rawLine: string): string | null => {
    let line = rawLine;
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (!line.startsWith("data: ")) return null;
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") return null;
    try {
      const parsed = JSON.parse(payload);
      const content = parsed.choices?.[0]?.delta?.content;
      return typeof content === "string" && content.length > 0 ? content : null;
    } catch {
      return null;
    }
  };

  return {
    /** Feed a decoded chunk; returns the content deltas it completed. */
    push(chunkText: string): string[] {
      buffer += chunkText;
      const deltas: string[] = [];
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const content = parseLine(line);
        if (content !== null) deltas.push(content);
      }
      return deltas;
    },

    /** Drain any remaining buffered data at end of stream. */
    flush(): string[] {
      const deltas: string[] = [];
      for (const line of buffer.split("\n")) {
        if (!line) continue;
        const content = parseLine(line);
        if (content !== null) deltas.push(content);
      }
      buffer = "";
      return deltas;
    },
  };
}
