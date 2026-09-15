import { describe, it, expect } from "vitest";
import { checkOutput, extractJson } from "./outputCheck";

describe("extractJson", () => {
  it("parses bare JSON, fenced JSON, and JSON embedded in prose", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Sure!\n```json\n{"a": 1}\n```\nDone.')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a": 1} hope that helps')).toEqual({ a: 1 });
    expect(extractJson("The list: [1, 2, 3].")).toEqual([1, 2, 3]);
  });

  it("returns null for no/invalid JSON", () => {
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson("{not: valid}")).toBeNull();
    expect(extractJson("")).toBeNull();
  });
});

describe("checkOutput", () => {
  it("returns null when the prompt has no check (unchecked categories)", () => {
    expect(checkOutput(undefined, "anything")).toBeNull();
  });

  it("json: requires an object with the required keys", () => {
    const c = { kind: "json" as const, requiredKeys: ["name", "age", "city"] };
    expect(checkOutput(c, '{"name":"Ada","age":36,"city":"London"}')).toBe(true);
    expect(checkOutput(c, '```json\n{"name":"Ada","age":36,"city":"London","extra":1}\n```')).toBe(true);
    expect(checkOutput(c, '{"name":"Ada"}')).toBe(false);
    expect(checkOutput(c, '["Ada", 36]')).toBe(false);
    expect(checkOutput(c, "Ada is 36 and lives in London.")).toBe(false);
  });

  it("json: array checks require an array of at least N items", () => {
    const c = { kind: "json" as const, arrayMinLength: 3 };
    expect(checkOutput(c, '["red","blue","yellow"]')).toBe(true);
    expect(checkOutput(c, '["red","blue"]')).toBe(false);
    expect(checkOutput(c, '{"colors":["red","blue","yellow"]}')).toBe(false);
  });

  it("regex: every pattern must match, case-insensitively; a bad pattern fails closed", () => {
    const c = { kind: "regex" as const, all: ["def\\s+is_palindrome\\s*\\(", "return"] };
    expect(checkOutput(c, "def is_palindrome(s):\n    return s == s[::-1]")).toBe(true);
    expect(checkOutput(c, "DEF IS_PALINDROME(S): RETURN S == S[::-1]")).toBe(true);
    expect(checkOutput(c, "def palindrome(s): return True")).toBe(false);
    expect(checkOutput({ kind: "regex", all: ["([unclosed"] }, "anything")).toBe(false);
  });
});
