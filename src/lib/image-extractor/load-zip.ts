import JSZip from "jszip";

const ABSOLUTE_IMAGE_SOURCE = /^(?:https?|data|blob|file):/i;

function resolvePath(base: string, relative: string): string {
  const segments = `${base}/${relative}`.replaceAll("\\", "/").split("/");
  const resolved: string[] = [];

  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  return resolved.join("/");
}

export async function loadZipAsHtml(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(file);
  let htmlPath: string | null = null;

  zip.forEach((path, entry) => {
    if (htmlPath === null && path.endsWith(".html") && !entry.dir) {
      htmlPath = entry.name;
    }
  });

  const htmlEntry = htmlPath === null ? null : zip.file(htmlPath);
  if (htmlEntry === null) {
    throw new Error("No HTML file found in the zip");
  }

  const html = await htmlEntry.async("text");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const separatorIndex = htmlEntry.name.lastIndexOf("/");
  const htmlDirectory = separatorIndex < 0 ? "" : htmlEntry.name.slice(0, separatorIndex);

  for (const image of Array.from(doc.querySelectorAll("img"))) {
    const source = image.getAttribute("src");
    if (source === null || source === "" || ABSOLUTE_IMAGE_SOURCE.test(source)) continue;

    const imageEntry = zip.file(resolvePath(htmlDirectory, source));
    if (imageEntry === null) continue;

    const blob = await imageEntry.async("blob");
    image.setAttribute("src", URL.createObjectURL(blob));
  }

  return doc.documentElement.outerHTML;
}
