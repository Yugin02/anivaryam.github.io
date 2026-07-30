import { describe, it, expect } from "vitest";
import { groupImages } from "./grouping";
import type { ExtractedImage } from "./extractor";

function makeImg(id: string): ExtractedImage {
  return {
    id,
    src: `data:image/png;base64,${id}`,
    alt: id,
    width: 100,
    height: 100,
    blob: null,
    filename: `${id}.png`,
  };
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("groupImages", () => {
  it("groups 4 images in a single <table> into 1 grid group", () => {
    const html =
      "<table><tr><td><img src='a'/></td><td><img src='b'/></td><td><img src='c'/></td><td><img src='d'/></td></tr></table>";
    const imgs = ["a", "b", "c", "d"].map(makeImg);
    const groups = groupImages(imgs, parse(html));
    expect(groups.length).toBe(1);
    expect(groups[0]!.layoutHint).toBe("grid");
    expect(groups[0]!.imageIds.length).toBe(4);
  });

  it("groups 3 inline images in one <p> as horizontal", () => {
    const html = "<p><img src='a'/><img src='b'/><img src='c'/></p>";
    const imgs = ["a", "b", "c"].map(makeImg);
    const groups = groupImages(imgs, parse(html));
    expect(groups.length).toBe(1);
    expect(groups[0]!.layoutHint).toBe("horizontal");
  });

  it("groups 3 separate <p> siblings with single images as vertical", () => {
    const html =
      "<div><p><img src='a'/></p><p><img src='b'/></p><p><img src='c'/></p></div>";
    const imgs = ["a", "b", "c"].map(makeImg);
    const groups = groupImages(imgs, parse(html));
    expect(groups.length).toBe(1);
    expect(groups[0]!.layoutHint).toBe("vertical");
  });

  it("creates 2 groups when 2 images are in a table + 1 in a separate <p>", () => {
    const html =
      "<table><tr><td><img src='a'/></td><td><img src='b'/></td></tr></table><p><img src='c'/></p>";
    const imgs = ["a", "b", "c"].map(makeImg);
    const groups = groupImages(imgs, parse(html));
    expect(groups.length).toBe(2);
    const gridGroup = groups.find((g) => g.layoutHint === "grid")!;
    const verticalGroup = groups.find((g) => g.layoutHint !== "grid")!;
    expect(gridGroup.imageIds.length).toBe(2);
    expect(verticalGroup.imageIds.length).toBe(1);
    expect(verticalGroup.imageIds[0]).toBe("c");
  });

  it("preserves the order of images within a group", () => {
    const html =
      "<table><tr><td><img src='a'/></td><td><img src='b'/></td><td><img src='c'/></td></tr></table>";
    const imgs = ["a", "b", "c"].map(makeImg);
    const groups = groupImages(imgs, parse(html));
    expect(groups[0]!.imageIds).toEqual(["a", "b", "c"]);
  });

  it("returns empty array if no images", () => {
    const groups = groupImages([], parse("<p>no images</p>"));
    expect(groups).toEqual([]);
  });
});
