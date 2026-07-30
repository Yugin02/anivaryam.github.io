/**
 * Group extracted images by their source-DOM layout.
 *
 * MVP rule (committed in design spec):
 *   - Any images sharing a <table> ancestor -> 1 group, layoutHint 'grid'.
 *   - Other images: smallest common block ancestor -> 1 group.
 *   - layoutHint: 'horizontal' if images are direct inline siblings of the ancestor,
 *                 'vertical' otherwise.
 */

import type { ExtractedImage } from "./extractor";

export type LayoutHint = "grid" | "horizontal" | "vertical";

export interface ImageGroup {
  id: string;
  label: string;
  imageIds: string[];
  layoutHint: LayoutHint;
}

interface TaggedImg {
  imgId: string;
  imgEl: HTMLImageElement;
  tableAncestor: HTMLTableElement | null;
  blockAncestor: HTMLElement | null;
}

function findTableAncestor(el: Element): HTMLTableElement | null {
  let cur: Element | null = el;
  while (cur) {
    if (cur.tagName === "TABLE") return cur as HTMLTableElement;
    cur = cur.parentElement;
  }
  return null;
}

function findBlockAncestor(el: Element): HTMLElement {
  const BLOCK = new Set(["P", "DIV", "SECTION", "LI", "BODY", "ARTICLE", "MAIN"]);
  let cur: Element | null = el.parentElement;
  while (cur && !BLOCK.has(cur.tagName)) {
    cur = cur.parentElement;
  }
  return (cur as HTMLElement) || (el.ownerDocument!.body as HTMLElement);
}

// Find the nearest common block ancestor for a set of elements.
// This is the closest block element that is an ancestor of ALL elements.
function findNearestCommonBlockAncestor(els: Element[]): HTMLElement | null {
  if (els.length === 0) return null;
  if (els.length === 1) return findBlockAncestor(els[0]);

  const BLOCK = new Set(["P", "DIV", "SECTION", "LI", "BODY", "ARTICLE", "MAIN"]);

  // For each element, collect its block ancestors (nearest first)
  const getBlockAncestorChain = (el: Element): HTMLElement[] => {
    const chain: HTMLElement[] = [];
    let cur: Element | null = el.parentElement;
    while (cur) {
      if (BLOCK.has(cur.tagName)) chain.push(cur as HTMLElement);
      cur = cur.parentElement;
    }
    return chain;
  };

  const chains = els.map(getBlockAncestorChain);
  if (chains.some((c) => c.length === 0)) return null;

  // Find the first common block in the first element's chain that appears in all chains
  // (starting from nearest to each element)
  for (const candidate of chains[0]!) {
    if (chains.slice(1).every((chain) => chain.some((b) => b === candidate))) {
      return candidate;
    }
  }

  return null;
}

function tag(imgIdToEl: Map<string, HTMLImageElement>): TaggedImg[] {
  const firstImg = imgIdToEl.values().next().value;
  if (!firstImg) return [];
  const doc = firstImg.ownerDocument!;
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  const result: TaggedImg[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node.nodeName === "IMG") {
      const el = node as HTMLImageElement;
      result.push({
        imgId: "",
        imgEl: el,
        tableAncestor: findTableAncestor(el),
        blockAncestor: findBlockAncestor(el),
      });
    }
    node = walker.nextNode();
  }
  return result;
}

export function groupImages(
  images: ExtractedImage[],
  sourceDoc: Document,
): ImageGroup[] {
  if (images.length === 0) return [];

  const domImgs = Array.from(sourceDoc.querySelectorAll("img"));
  const bySrc = new Map<string, HTMLImageElement[]>();
  for (const dom of domImgs) {
    const s = dom.getAttribute("src") || "";
    if (!bySrc.has(s)) bySrc.set(s, []);
    bySrc.get(s)!.push(dom);
  }

  const usedDom = new WeakSet<HTMLImageElement>();
  const tagged: TaggedImg[] = [];
  let fallbackIdx = 0;
  for (const img of images) {
    const candidates = bySrc.get(img.src) || [];
    const available = candidates.find((d) => !usedDom.has(d));
    let el: HTMLImageElement | undefined = available;
    if (!el) {
      while (fallbackIdx < domImgs.length && usedDom.has(domImgs[fallbackIdx]!)) {
        fallbackIdx++;
      }
      el = domImgs[fallbackIdx++];
    }
    if (el) {
      usedDom.add(el);
      tagged.push({
        imgId: img.id,
        imgEl: el,
        tableAncestor: findTableAncestor(el),
        blockAncestor: findBlockAncestor(el),
      });
    }
  }

  // Separate table-grouped and non-table images
  const tableTagged = tagged.filter((t) => t.tableAncestor !== null);
  const nonTableTagged = tagged.filter((t) => t.tableAncestor === null);

  const groups: ImageGroup[] = [];
  let groupIdx = 1;

  // Group table images by their table ancestor
  const tableGroups = new Map<HTMLTableElement, TaggedImg[]>();
  for (const t of tableTagged) {
    if (t.tableAncestor) {
      const arr = tableGroups.get(t.tableAncestor) || [];
      arr.push(t);
      tableGroups.set(t.tableAncestor, arr);
    }
  }
  for (const [, members] of tableGroups) {
    groups.push({
      id: `g${groupIdx++}`,
      label: `Group ${groupIdx - 1}`,
      imageIds: members.map((m) => m.imgId),
      layoutHint: "grid",
    });
  }

  // For non-table images, find the common block ancestor for grouping
  if (nonTableTagged.length > 0) {
    // Find the common block ancestor across ALL non-table images
    const commonBlock = findNearestCommonBlockAncestor(nonTableTagged.map((t) => t.imgEl));
    if (commonBlock) {
      // All non-table images share a common block ancestor -> one group
      const layoutHint = detectBlockLayout(nonTableTagged, commonBlock);
      groups.push({
        id: `g${groupIdx++}`,
        label: `Group ${groupIdx - 1}`,
        imageIds: nonTableTagged.map((m) => m.imgId),
        layoutHint,
      });
    } else {
      // No common block ancestor -> each image its own group
      for (const t of nonTableTagged) {
        groups.push({
          id: `g${groupIdx++}`,
          label: `Group ${groupIdx - 1}`,
          imageIds: [t.imgId],
          layoutHint: "horizontal",
        });
      }
    }
  }

  return groups;
}

function detectBlockLayout(members: TaggedImg[], parent: HTMLElement): LayoutHint {
  if (members.length <= 1) return "horizontal";
  const directChildren = members.filter(
    (m) => m.imgEl.parentElement === parent,
  ).length;
  if (directChildren === members.length) {
    return "horizontal";
  }
  return "vertical";
}
