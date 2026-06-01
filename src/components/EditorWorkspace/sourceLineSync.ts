export type SourceLineSyncSource = "editor" | "preview";

export interface SourceLineSyncSignal {
  source: SourceLineSyncSource;
  line: number;
  revision: number;
}

function readSourceLine(element: Element): number | null {
  const value = Number.parseFloat((element as HTMLElement).dataset.sourceLine ?? "");
  return Number.isFinite(value) ? value : null;
}

function readSourceEndLine(element: Element): number | null {
  const value = Number.parseFloat((element as HTMLElement).dataset.sourceEndLine ?? "");
  return Number.isFinite(value) ? value : readSourceLine(element);
}

function getSourceLineElements(container: HTMLElement): HTMLElement[] {
  const elements = Array.from(container.querySelectorAll<HTMLElement>("[data-source-line]")).filter(
    (element) => readSourceLine(element) !== null,
  );
  const leafElements = elements.filter((element) => !element.querySelector("[data-source-line]"));
  return leafElements.length > 0 ? leafElements : elements;
}

export function findPreviewElementForSourceLine(container: HTMLElement, sourceLine: number): HTMLElement | null {
  const elements = getSourceLineElements(container);
  if (elements.length === 0) return null;

  let fallback: HTMLElement | null = null;
  for (const element of elements) {
    const line = readSourceLine(element);
    if (line === null) continue;
    if (line > sourceLine) break;
    fallback = element;
  }

  return fallback ?? elements[0];
}

function findPreviewElementBoundsForSourceLine(
  container: HTMLElement,
  sourceLine: number,
): { previous: HTMLElement; next: HTMLElement | null } | null {
  const elements = getSourceLineElements(container);
  if (elements.length === 0) return null;

  let previous = elements[0];
  for (const element of elements) {
    const line = readSourceLine(element);
    if (line === null) continue;
    if (line > sourceLine) {
      return { previous, next: element };
    }
    previous = element;
  }

  return { previous, next: null };
}

export function getTopVisibleSourceLine(scrollContainer: HTMLElement, contentContainer: HTMLElement): number | null {
  const containerTop = scrollContainer.getBoundingClientRect().top;
  const elements = getSourceLineElements(contentContainer);

  let previous: HTMLElement | null = null;
  let previousLine: number | null = null;

  for (const element of elements) {
    const rect = element.getBoundingClientRect();
    const line = readSourceLine(element);
    if (line === null) continue;

    if (rect.top >= containerTop) {
      if (previous && previousLine !== null && line > previousLine) {
        const previousTop = previous.getBoundingClientRect().top;
        const distance = rect.top - previousTop;
        if (distance > 0) {
          const progress = Math.min(1, Math.max(0, (containerTop - previousTop) / distance));
          return previousLine + (line - previousLine) * progress;
        }
      }

      return line;
    }

    if (rect.bottom > containerTop) {
      const endLine = readSourceEndLine(element);
      if (endLine !== null && endLine > line && rect.height > 0) {
        const progress = Math.min(1, Math.max(0, (containerTop - rect.top) / rect.height));
        return line + (endLine - line) * progress;
      }
      return line;
    }

    previous = element;
    previousLine = line;
  }

  return elements.length > 0 ? readSourceLine(elements[elements.length - 1]) : null;
}

export function scrollPreviewToSourceLine(
  scrollContainer: HTMLElement,
  contentContainer: HTMLElement,
  sourceLine: number,
) {
  const bounds = findPreviewElementBoundsForSourceLine(contentContainer, sourceLine);
  if (!bounds) return;

  const target = bounds.previous;
  const previousLine = readSourceLine(bounds.previous);
  const previousEndLine = readSourceEndLine(bounds.previous);
  const nextLine = bounds.next ? readSourceLine(bounds.next) : null;

  const containerTop = scrollContainer.getBoundingClientRect().top;
  const previousTop = target.getBoundingClientRect().top;
  const previousRect = target.getBoundingClientRect();
  let targetTop = previousTop;

  if (
    previousLine !== null
    && previousEndLine !== null
    && previousEndLine > previousLine
    && sourceLine >= previousLine
    && sourceLine <= previousEndLine
    && previousRect.height > 0
  ) {
    const progress = Math.min(1, Math.max(0, (sourceLine - previousLine) / (previousEndLine - previousLine)));
    targetTop = previousRect.top + previousRect.height * progress;
    scrollContainer.scrollTop += targetTop - containerTop;
    return;
  }

  if (bounds.next && previousLine !== null && nextLine !== null && nextLine > previousLine) {
    const nextTop = bounds.next.getBoundingClientRect().top;
    const progress = Math.min(1, Math.max(0, (sourceLine - previousLine) / (nextLine - previousLine)));
    targetTop = previousTop + (nextTop - previousTop) * progress;
  }

  scrollContainer.scrollTop += targetTop - containerTop;
}
