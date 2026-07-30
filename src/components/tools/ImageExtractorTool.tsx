import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Download, X, GitMerge } from "lucide-react";
import { extractImages, downloadImage, type ExtractedImage } from "@/lib/image-extractor/extractor";
import { groupImages, type ImageGroup, type LayoutHint } from "@/lib/image-extractor/grouping";
import {
  applyTransforms,
  type TransformPipeline,
  type TargetFormat,
} from "@/lib/image-transforms/transforms";

interface TransformOptions {
  compress: { enabled: boolean; quality: number };
  format: { enabled: boolean; target: TargetFormat };
  resize: { enabled: boolean; mode: "exact" | "fit" | "fill"; width?: number; height?: number };
  upscale: { enabled: boolean; factor: 1.5 | 2 | 3 | 4 };
  stripExif: boolean;
}

const DEFAULT_TRANSFORMS: TransformOptions = {
  compress: { enabled: false, quality: 80 },
  format: { enabled: false, target: "png" },
  resize: { enabled: false, mode: "exact" },
  upscale: { enabled: false, factor: 2 },
  stripExif: false,
};

export function ImageExtractorTool() {
  const { toast } = useToast();
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const [inputHtml, setInputHtml] = useState<string>("");
  const [images, setImages] = useState<Record<string, ExtractedImage>>({});
  const [groups, setGroups] = useState<ImageGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [transforms, setTransforms] = useState<TransformOptions>(DEFAULT_TRANSFORMS);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const draggedImageId = useRef<string | null>(null);

  useEffect(() => {
    const el = inputAreaRef.current;
    if (!el) return;
    const onPaste = () => {
      setTimeout(() => {
        const html = el.innerHTML;
        if (html.trim()) setInputHtml(html);
      }, 10);
    };
    const onInput = () => setInputHtml(el.innerHTML);
    el.addEventListener("paste", onPaste);
    el.addEventListener("input", onInput);
    return () => {
      el.removeEventListener("paste", onPaste);
      el.removeEventListener("input", onInput);
    };
  }, []);

  useEffect(() => {
    if (!inputHtml.trim()) {
      setImages({});
      setGroups([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const extracted = await extractImages(inputHtml);
        const byId: Record<string, ExtractedImage> = {};
        for (const e of extracted) byId[e.id] = e;
        setImages(byId);
        const parser = new DOMParser();
        const sourceDoc = parser.parseFromString(inputHtml, "text/html");
        const newGroups = groupImages(extracted, sourceDoc);
        setGroups(newGroups);
        toast({
          title: `Extracted ${extracted.length} image${extracted.length === 1 ? "" : "s"}`,
          description: `Grouped into ${newGroups.length} group${newGroups.length === 1 ? "" : "s"}.`,
        });
      } catch (e) {
        toast({
          title: "Extraction failed",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [inputHtml, toast]);

  const clearAll = useCallback(() => {
    if (inputAreaRef.current) inputAreaRef.current.innerHTML = "";
    setInputHtml("");
    setImages({});
    setGroups([]);
  }, []);

  const rebuildPipeline = (): TransformPipeline => {
    const p: TransformPipeline = {};
    if (transforms.upscale?.enabled) p.upscale = { factor: transforms.upscale.factor };
    if (transforms.resize?.enabled && transforms.resize.width && transforms.resize.height) {
      p.resize = {
        mode: transforms.resize.mode,
        width: transforms.resize.width,
        height: transforms.resize.height,
      };
    }
    if (transforms.format?.enabled) p.format = { target: transforms.format.target };
    if (transforms.stripExif) p.stripExif = true;
    if (transforms.compress?.enabled) p.compress = { quality: transforms.compress.quality };
    return p;
  };

  const handleDownload = useCallback(
    async (img: ExtractedImage) => {
      if (!img.blob) {
        toast({ title: "Cannot download", description: img.fetchError ?? "No image data", variant: "destructive" });
        return;
      }
      try {
        const pipeline = rebuildPipeline();
        const out = pipeline && Object.keys(pipeline).length > 0
          ? await applyTransforms(img.blob, pipeline)
          : img.blob;
        downloadImage(out, img.filename);
      } catch (e) {
        toast({
          title: "Transform failed — downloading original",
          description: e instanceof Error ? e.message : String(e),
        });
        downloadImage(img.blob, img.filename);
      }
    },
    [transforms, toast],
  );

  const onDragStart = (e: React.DragEvent, imgId: string) => {
    draggedImageId.current = imgId;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", imgId);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const onDropGroup = (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    const imgId = e.dataTransfer.getData("text/plain") || draggedImageId.current;
    if (!imgId) return;
    const img = images[imgId];
    if (!img) return;
    let sourceGroupId: string | null = null;
    for (const g of groups) {
      if (g.imageIds.includes(imgId)) {
        sourceGroupId = g.id;
        break;
      }
    }
    if (!sourceGroupId || sourceGroupId === targetGroupId) return;
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id === sourceGroupId) {
          return { ...g, imageIds: g.imageIds.filter((id) => id !== imgId) };
        }
        if (g.id === targetGroupId) {
          return { ...g, imageIds: [...g.imageIds, imgId] };
        }
        return g;
      }),
    );
    draggedImageId.current = null;
  };

  const toggleSelected = (imgId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(imgId)) next.delete(imgId);
      else next.add(imgId);
      return next;
    });
  };

  const splitSelected = (sourceGroupId: string) => {
    const source = groups.find((g) => g.id === sourceGroupId);
    if (!source) return;
    const toSplit = source.imageIds.filter((id) => selectedIds.has(id));
    if (toSplit.length === 0) return;
    const newGroup: ImageGroup = {
      id: `g${Math.max(...groups.map((g) => Number(g.id.slice(1)) || 0), 0) + 1}`,
      label: `Group ${groups.length + 1}`,
      imageIds: toSplit,
      layoutHint: toSplit.length > 1 ? "horizontal" : "horizontal",
    };
    setGroups((prev) => {
      const updated = prev.flatMap((g) => {
        if (g.id !== sourceGroupId) return [g];
        const remaining = g.imageIds.filter((id) => !toSplit.includes(id));
        if (remaining.length === 0) return [];
        return [{ ...g, imageIds: remaining }];
      });
      return [...updated, newGroup];
    });
    setSelectedIds(new Set());
  };

  const mergeInto = (sourceGroupId: string, targetGroupId: string) => {
    if (sourceGroupId === targetGroupId) return;
    const source = groups.find((g) => g.id === sourceGroupId);
    if (!source) return;
    setGroups((prev) => {
      const updated = prev.flatMap((g) => {
        if (g.id === targetGroupId) {
          return [{ ...g, imageIds: [...g.imageIds, ...source.imageIds] }];
        }
        if (g.id === sourceGroupId) return [];
        return [g];
      });
      return updated;
    });
  };

  const removeEmptyGroups = (next: ImageGroup[]): ImageGroup[] =>
    next.filter((g) => g.imageIds.length > 0);

  useEffect(() => {
    setGroups((prev) => removeEmptyGroups(prev));
  }, [images]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
            Input
          </CardTitle>
          {inputHtml && (
            <Button variant="ghost" size="sm" onClick={clearAll} title="Clear">
              <X className="h-4 w-4" />
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex-1 flex flex-col">
          <div
            ref={inputAreaRef}
            contentEditable
            data-placeholder="Paste content from Google Docs / Word here..."
            className="flex-1 min-h-[300px] max-h-[60vh] p-4 text-sm bg-background border border-border rounded-lg overflow-auto focus:outline-none focus:ring-2 focus:ring-primary/20"
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          />
          {loading && (
            <p className="mt-2 text-xs text-muted-foreground">Extracting images…</p>
          )}
        </CardContent>
      </Card>

      <Card className="flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
            Extracted
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {Object.keys(images).length} image{Object.keys(images).length === 1 ? "" : "s"} ·{" "}
            {groups.length} group{groups.length === 1 ? "" : "s"}
          </span>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col gap-4">
          <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="w-full justify-between">
                Transform settings (applied on download)
                <ChevronDown className={`h-4 w-4 transition-transform ${settingsOpen ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-3">
              <TransformsPanel transforms={transforms} setTransforms={setTransforms} />
            </CollapsibleContent>
          </Collapsible>

          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Paste content with images to see them grouped here.
            </p>
          ) : (
            <div className="space-y-4">
              {groups.map((g, gIdx) => (
                <div
                  key={g.id}
                  onDragOver={onDragOver}
                  onDrop={(e) => onDropGroup(e, g.id)}
                  className="rounded-lg border border-border p-3"
                >
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <span className="text-xs font-medium">
                      {g.label} · <span className="text-muted-foreground">{g.layoutHint}</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{g.imageIds.length} images</span>
                      {gIdx > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => mergeInto(g.id, groups[gIdx - 1]!.id)}
                          title="Merge into previous group"
                          className="h-6 px-2"
                        >
                          <GitMerge className="h-3 w-3" />
                        </Button>
                      )}
                      {g.imageIds.some((id) => selectedIds.has(id)) && g.imageIds.length > 1 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => splitSelected(g.id)}
                          className="h-6 px-2 text-xs"
                        >
                          Split selected
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className={gridClassFor(g.layoutHint)}>
                    {g.imageIds.map((id) => {
                      const img = images[id];
                      if (!img) return null;
                      const isSelected = selectedIds.has(id);
                      return (
                        <div
                          key={id}
                          draggable
                          onDragStart={(e) => onDragStart(e, id)}
                          className={`relative group border rounded overflow-hidden bg-muted ${isSelected ? "border-primary ring-2 ring-primary/30" : "border-border/50"}`}
                        >
                          {img.blob ? (
                            <img
                              src={URL.createObjectURL(img.blob)}
                              alt={img.alt}
                              className="w-full h-24 object-contain"
                              onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                            />
                          ) : (
                            <div className="w-full h-24 flex items-center justify-center text-xs text-destructive">
                              {img.fetchError ?? "Failed"}
                            </div>
                          )}
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelected(id)}
                            className="absolute top-1 right-1 bg-background/80 backdrop-blur"
                            aria-label={`Select ${img.filename}`}
                          />
                          <button
                            onClick={() => handleDownload(img)}
                            className="absolute bottom-1 right-1 bg-background/80 backdrop-blur p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Download"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </button>
                          <span className="absolute bottom-1 left-1 text-[10px] bg-background/80 backdrop-blur px-1 py-0.5 rounded truncate max-w-[80%]">
                            {img.filename}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function gridClassFor(hint: LayoutHint): string {
  if (hint === "horizontal") return "flex flex-wrap gap-2";
  if (hint === "vertical") return "flex flex-col gap-2";
  return "grid grid-cols-2 sm:grid-cols-3 gap-2";
}

interface TransformsPanelProps {
  transforms: TransformOptions;
  setTransforms: (t: TransformOptions) => void;
}

function TransformsPanel({ transforms, setTransforms }: TransformsPanelProps) {
  const update = (patch: Partial<TransformOptions>) => setTransforms({ ...transforms, ...patch });
  return (
    <div className="space-y-3 text-xs">
      <FieldRow label="Compress" enabled={transforms.compress?.enabled} onToggle={(v) => update({ compress: { quality: 80, ...transforms.compress, enabled: v } })}>
        <Input
          type="number"
          min={1}
          max={100}
          value={transforms.compress?.quality ?? 80}
          onChange={(e) => update({ compress: { ...transforms.compress!, quality: Number(e.target.value) } })}
          className="w-20 h-7"
          disabled={!transforms.compress?.enabled}
        />
      </FieldRow>
      <FieldRow label="Format" enabled={transforms.format?.enabled} onToggle={(v) => update({ format: { target: "png", ...transforms.format, enabled: v } })}>
        <select
          value={transforms.format?.target ?? "png"}
          onChange={(e) => update({ format: { ...transforms.format!, target: e.target.value as any } })}
          className="h-7 bg-background border border-border rounded px-2"
          disabled={!transforms.format?.enabled}
        >
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
          <option value="webp">WebP</option>
        </select>
      </FieldRow>
      <FieldRow label="Resize" enabled={transforms.resize?.enabled} onToggle={(v) => update({ resize: { mode: "exact", ...transforms.resize, enabled: v } })}>
        <div className="flex items-center gap-1">
          <Input type="number" placeholder="W" value={transforms.resize?.width ?? ""} onChange={(e) => update({ resize: { ...transforms.resize!, width: e.target.value ? Number(e.target.value) : undefined } })} className="w-16 h-7" disabled={!transforms.resize?.enabled} />
          <span>×</span>
          <Input type="number" placeholder="H" value={transforms.resize?.height ?? ""} onChange={(e) => update({ resize: { ...transforms.resize!, height: e.target.value ? Number(e.target.value) : undefined } })} className="w-16 h-7" disabled={!transforms.resize?.enabled} />
        </div>
      </FieldRow>
      <FieldRow label="Upscale" enabled={transforms.upscale?.enabled} onToggle={(v) => update({ upscale: { factor: 2, ...transforms.upscale, enabled: v } })}>
        <select
          value={transforms.upscale?.factor ?? 2}
          onChange={(e) => update({ upscale: { ...transforms.upscale!, factor: Number(e.target.value) as any } })}
          className="h-7 bg-background border border-border rounded px-2"
          disabled={!transforms.upscale?.enabled}
        >
          <option value={1.5}>1.5×</option>
          <option value={2}>2×</option>
          <option value={3}>3×</option>
          <option value={4}>4×</option>
        </select>
      </FieldRow>
      <div className="flex items-center gap-2">
        <Checkbox
          id="strip-exif"
          checked={transforms.stripExif}
          onCheckedChange={(v) => update({ stripExif: !!v })}
        />
        <Label htmlFor="strip-exif" className="text-xs">Strip EXIF / metadata</Label>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  enabled?: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={`field-${label}`}
        checked={!!enabled}
        onCheckedChange={(v) => onToggle(!!v)}
      />
      <Label htmlFor={`field-${label}`} className="text-xs w-20">{label}</Label>
      {children}
    </div>
  );
}
