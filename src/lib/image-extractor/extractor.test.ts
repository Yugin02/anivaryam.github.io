import { describe, it, expect } from "vitest";
import { formatImageName, extractImages } from "./extractor";

describe("formatImageName", () => {
  it("uses alt text when available", () => {
    expect(formatImageName("data:image/png;base64,AAA", "my-photo", 0)).toBe(
      "my-photo",
    );
  });

  it("sanitizes alt text to be filename-safe", () => {
    expect(formatImageName("x", "my photo /test 1", 5)).toBe("my_photo_test_1");
  });

  it("falls back to image-N when alt is empty", () => {
    expect(formatImageName("x", "", 3)).toBe("image-4");
  });

  it("returns extension inferred from src mime", () => {
    const name = formatImageName("data:image/jpeg;base64,X", "", 0);
    expect(name).toMatch(/\.jpg$/);
  });

  it("returns .png for data URIs without explicit mime", () => {
    const name = formatImageName("https://example.com/x.png", "", 0);
    expect(name).toMatch(/\.png$/);
  });
});

describe("extractImages", () => {
  it("returns empty array for HTML with no images", async () => {
    const result = await extractImages("<p>hello world</p>");
    expect(result).toEqual([]);
  });

  it("extracts a single img tag with src attribute", async () => {
    const html =
      '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAGUlEQVR4nGNkYGD4z8DAwMDw//9JD4MAAAAASUVORK5CYII=" alt="red-dot" />';
    const result = await extractImages(html);
    expect(result.length).toBe(1);
    expect(result[0]!.alt).toBe("red-dot");
    expect(result[0]!.blob).toBeInstanceOf(Blob);
    expect(result[0]!.blob!.size).toBeGreaterThan(0);
  });

  it("sets fetchError for malformed src", async () => {
    const result = await extractImages('<img src="not-a-valid-url-or-data-uri" />');
    expect(result.length).toBe(1);
    expect(result[0]!.blob).toBeNull();
    expect(result[0]!.fetchError).toBeDefined();
  });
});
