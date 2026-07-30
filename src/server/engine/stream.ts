/**
 * Turning the CLI's newline-delimited JSON into events.
 *
 * The CLI writes one JSON object per line, but a chunk boundary can fall
 * anywhere, including mid-object, so lines are buffered until complete. A line
 * that will not parse is reported rather than dropped: silently discarding
 * output is how a review loses the result it was waiting for.
 */

import { toEngineEvent, type EngineEvent } from "@/lib/engine/events";

export class StreamDecoder {
  private buffer = "";
  private readonly malformed: string[] = [];

  /** Feeds a chunk of stdout and returns whatever events completed. */
  push(chunk: string): EngineEvent[] {
    this.buffer += chunk;
    const events: EngineEvent[] = [];

    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      const event = this.decodeLine(line);
      if (event) events.push(event);
      newlineIndex = this.buffer.indexOf("\n");
    }

    return events;
  }

  /** Decodes anything left without a trailing newline at end of stream. */
  flush(): EngineEvent[] {
    const remaining = this.buffer;
    this.buffer = "";
    const event = this.decodeLine(remaining);
    return event ? [event] : [];
  }

  /** Lines that were not JSON. Non-empty means the transcript has a hole. */
  malformedLines(): readonly string[] {
    return this.malformed;
  }

  private decodeLine(line: string): EngineEvent | null {
    const trimmed = line.trim();
    if (trimmed === "") return null;
    try {
      return toEngineEvent(JSON.parse(trimmed));
    } catch {
      this.malformed.push(trimmed.slice(0, 500));
      return null;
    }
  }
}
