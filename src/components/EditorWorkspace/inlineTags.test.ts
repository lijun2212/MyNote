import { describe, expect, it } from "vitest";
import { findInlineTagMatches } from "./inlineTags";

describe("inlineTags", () => {
  it("matches inline tags at line start or after whitespace", () => {
    expect(findInlineTagMatches("#项目报告 与 #phase_1")).toEqual([
      { start: 0, end: 5, name: "项目报告" },
      { start: 8, end: 16, name: "phase_1" },
    ]);
  });

  it("skips markdown headings, urls, paths, and embedded hash fragments", () => {
    expect(findInlineTagMatches("# Heading\nsee http://a#b /foo#bar abc#tag #有效标签")).toEqual([
      expect.objectContaining({ name: "有效标签" }),
    ]);
  });
});