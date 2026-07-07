import { describe, it, expect } from "vitest";
import { createSseParser } from "./sse";

const evt = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n`;

describe("createSseParser", () => {
  it("parses complete events in a single chunk", () => {
    const p = createSseParser();
    expect(p.push(evt("Hello") + evt(" world"))).toEqual(["Hello", " world"]);
  });

  it("buffers JSON split across chunk boundaries", () => {
    const p = createSseParser();
    const full = evt("split-token");
    const cut = Math.floor(full.length / 2);
    expect(p.push(full.slice(0, cut))).toEqual([]);
    expect(p.push(full.slice(cut))).toEqual(["split-token"]);
  });

  it("handles CRLF line endings", () => {
    const p = createSseParser();
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content: "crlf" } }] })}\r\n`;
    expect(p.push(line)).toEqual(["crlf"]);
  });

  it("ignores [DONE], comments, and empty deltas", () => {
    const p = createSseParser();
    const chunk =
      "data: [DONE]\n" +
      ": keep-alive\n" +
      `data: ${JSON.stringify({ choices: [{ delta: {} }] })}\n` +
      evt("real");
    expect(p.push(chunk)).toEqual(["real"]);
  });

  it("skips a malformed complete line without stalling later events", () => {
    const p = createSseParser();
    const chunk = "data: {not-json\n" + evt("after-bad-line");
    expect(p.push(chunk)).toEqual(["after-bad-line"]);
  });

  it("flush() drains an unterminated final event", () => {
    const p = createSseParser();
    const full = evt("tail").trimEnd(); // no trailing newline
    expect(p.push(full)).toEqual([]);
    expect(p.flush()).toEqual(["tail"]);
  });

  it("flush() on empty buffer returns nothing", () => {
    const p = createSseParser();
    expect(p.flush()).toEqual([]);
  });
});
