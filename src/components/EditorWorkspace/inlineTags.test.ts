import { describe, expect, it } from "vitest";
import { findInlineTagMatches } from "./inlineTags";

describe("inlineTags", () => {
  it("matches explicit tag references written as [[#标签名]]", () => {
    expect(findInlineTagMatches("[[#项目报告]] 与 [[#phase_1]]")).toEqual([
      { start: 0, end: 9, name: "项目报告" },
      { start: 12, end: 24, name: "phase_1" },
    ]);
  });

  it("skips headings, bare hashtags, and normal wiki links", () => {
    expect(
      findInlineTagMatches("# Heading\nsee http://a#b /foo#bar abc#tag #有效标签 [[普通链接]] [[页面#锚点]]"),
    ).toEqual([]);
  });
});