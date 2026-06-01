import { describe, expect, it } from "vitest";
import { findPreviewElementForSourceLine, getTopVisibleSourceLine, scrollPreviewToSourceLine } from "./sourceLineSync";

describe("sourceLineSync", () => {
  it("finds the nearest preview block at or before a source line", () => {
    const container = document.createElement("div");
    container.innerHTML = [
      '<h2 data-source-line="10">Section 1</h2>',
      '<p data-source-line="14">Paragraph</p>',
      '<h2 data-source-line="30">Section 2</h2>',
    ].join("");

    expect(findPreviewElementForSourceLine(container, 9)?.dataset.sourceLine).toBe("10");
    expect(findPreviewElementForSourceLine(container, 16)?.dataset.sourceLine).toBe("14");
    expect(findPreviewElementForSourceLine(container, 40)?.dataset.sourceLine).toBe("30");
  });

  it("interpolates the source line before the first fully visible preview block", () => {
    const scrollContainer = document.createElement("div");
    const content = document.createElement("div");
    scrollContainer.appendChild(content);
    content.innerHTML = [
      '<h2 data-source-line="10">Section 1</h2>',
      '<p data-source-line="14">Paragraph</p>',
      '<h2 data-source-line="30">Section 2</h2>',
    ].join("");

    scrollContainer.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 100,
      right: 600,
      bottom: 500,
      width: 600,
      height: 400,
      toJSON: () => ({}),
    });

    const [first, second, third] = Array.from(content.children) as HTMLElement[];
    first.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 40, right: 600, bottom: 80, width: 600, height: 40, toJSON: () => ({}) });
    second.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 120, right: 600, bottom: 160, width: 600, height: 40, toJSON: () => ({}) });
    third.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 200, right: 600, bottom: 240, width: 600, height: 40, toJSON: () => ({}) });

    expect(getTopVisibleSourceLine(scrollContainer, content)).toBe(13);
  });

  it("interpolates the top visible source line between preview blocks", () => {
    const scrollContainer = document.createElement("div");
    const content = document.createElement("div");
    scrollContainer.appendChild(content);
    content.innerHTML = [
      '<h2 data-source-line="10">Section 1</h2>',
      '<h2 data-source-line="30">Section 2</h2>',
    ].join("");

    scrollContainer.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 200,
      right: 600,
      bottom: 600,
      width: 600,
      height: 400,
      toJSON: () => ({}),
    });

    const [first, second] = Array.from(content.children) as HTMLElement[];
    first.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 100, right: 600, bottom: 140, width: 600, height: 40, toJSON: () => ({}) });
    second.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 300, right: 600, bottom: 340, width: 600, height: 40, toJSON: () => ({}) });

    expect(getTopVisibleSourceLine(scrollContainer, content)).toBe(20);
  });

  it("interpolates source line while the viewport is inside a tall preview block", () => {
    const scrollContainer = document.createElement("div");
    const content = document.createElement("div");
    scrollContainer.appendChild(content);
    content.innerHTML = '<table data-source-line="50" data-source-end-line="90"></table>';

    scrollContainer.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 300,
      right: 600,
      bottom: 700,
      width: 600,
      height: 400,
      toJSON: () => ({}),
    });

    const table = content.querySelector("table") as HTMLElement;
    table.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 100,
      right: 600,
      bottom: 500,
      width: 600,
      height: 400,
      toJSON: () => ({}),
    });

    expect(getTopVisibleSourceLine(scrollContainer, content)).toBe(70);
  });

  it("uses table rows instead of the whole table as sync anchors", () => {
    const scrollContainer = document.createElement("div");
    const content = document.createElement("div");
    scrollContainer.appendChild(content);
    content.innerHTML = [
      '<table data-source-line="50" data-source-end-line="90">',
      '<tbody>',
      '<tr data-source-line="60" data-source-end-line="61"></tr>',
      '<tr data-source-line="61" data-source-end-line="62"></tr>',
      '</tbody>',
      '</table>',
    ].join("");

    scrollContainer.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 150,
      right: 600,
      bottom: 550,
      width: 600,
      height: 400,
      toJSON: () => ({}),
    });

    const table = content.querySelector("table") as HTMLElement;
    const [firstRow, secondRow] = Array.from(content.querySelectorAll("tr")) as HTMLElement[];
    table.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
    firstRow.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 100, right: 600, bottom: 140, width: 600, height: 40, toJSON: () => ({}) });
    secondRow.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 160, right: 600, bottom: 200, width: 600, height: 40, toJSON: () => ({}) });

    expect(getTopVisibleSourceLine(scrollContainer, content)).toBeCloseTo(60.83, 2);
  });

  it("interpolates preview scroll positions between source-marked blocks", () => {
    const scrollContainer = document.createElement("div");
    const content = document.createElement("div");
    scrollContainer.appendChild(content);
    content.innerHTML = [
      '<h2 data-source-line="10">Section 1</h2>',
      '<h2 data-source-line="30">Section 2</h2>',
    ].join("");

    scrollContainer.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 500,
      width: 600,
      height: 500,
      toJSON: () => ({}),
    });

    const [first, second] = Array.from(content.children) as HTMLElement[];
    first.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 100, right: 600, bottom: 140, width: 600, height: 40, toJSON: () => ({}) });
    second.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 300, right: 600, bottom: 340, width: 600, height: 40, toJSON: () => ({}) });

    scrollPreviewToSourceLine(scrollContainer, content, 20);

    expect(scrollContainer.scrollTop).toBe(200);
  });

  it("scrolls preview inside a tall block when the source line is inside that block", () => {
    const scrollContainer = document.createElement("div");
    const content = document.createElement("div");
    scrollContainer.appendChild(content);
    content.innerHTML = '<table data-source-line="50" data-source-end-line="90"></table>';

    scrollContainer.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 500,
      width: 600,
      height: 500,
      toJSON: () => ({}),
    });

    const table = content.querySelector("table") as HTMLElement;
    table.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 100,
      right: 600,
      bottom: 500,
      width: 600,
      height: 400,
      toJSON: () => ({}),
    });

    scrollPreviewToSourceLine(scrollContainer, content, 70);

    expect(scrollContainer.scrollTop).toBe(300);
  });

  it("scrolls preview to table row anchors instead of the whole table", () => {
    const scrollContainer = document.createElement("div");
    const content = document.createElement("div");
    scrollContainer.appendChild(content);
    content.innerHTML = [
      '<table data-source-line="50" data-source-end-line="90">',
      '<tbody>',
      '<tr data-source-line="60" data-source-end-line="61"></tr>',
      '<tr data-source-line="61" data-source-end-line="62"></tr>',
      '</tbody>',
      '</table>',
    ].join("");

    scrollContainer.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 500, width: 600, height: 500, toJSON: () => ({}) });
    const table = content.querySelector("table") as HTMLElement;
    const [firstRow, secondRow] = Array.from(content.querySelectorAll("tr")) as HTMLElement[];
    table.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
    firstRow.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 100, right: 600, bottom: 140, width: 600, height: 40, toJSON: () => ({}) });
    secondRow.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 160, right: 600, bottom: 200, width: 600, height: 40, toJSON: () => ({}) });

    scrollPreviewToSourceLine(scrollContainer, content, 60.5);

    expect(scrollContainer.scrollTop).toBe(120);
  });
});
