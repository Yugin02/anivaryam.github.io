import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronDown, Download, GitMerge, X } from "lucide-react";
import { extractImages, downloadImage, type ExtractedImage } from "@/lib/image-extractor/extractor";
import { groupImages, type ImageGroup, type LayoutHint } from "@/lib/image-extractor/grouping";
import {
  applyTransforms,
  type TargetFormat,
  type TransformPipeline,
} from "@/lib/image-transforms/transforms";
import { ImageCombinerModal } from "./ImageCombinerModal";

interface GroupTransformOptions {
  compress: { enabled: boolean; quality: number };
  format: { enabled: boolean; target: TargetFormat };
  resize: { enabled: boolean; mode: "exact" | "fit" | "fill"; width?: number; height?: number };
  upscale: { enabled: boolean; factor: 1.5 | 2 | 3 | 4 };
  stripExif: boolean;
}

const DEFAULT_GROUP_TRANSFORMS: GroupTransformOptions = {
  compress: { enabled: false, quality: 80 },
  format: { enabled: false, target: "png" },
  resize: { enabled: false, mode: "exact" },
  upscale: { enabled: false, factor: 2 },
  stripExif: false,
};

function rebuildPipeline(t: GroupTransformOptions): TransformPipeline {
  const p: TransformPipeline = {};
  if (t.upscale.enabled) p.upscale = { factor: t.upscale.factor };
  if (t.resize.enabled && t.resize.width && t.resize.height) {
    p.resize = {
      mode: t.resize.mode,
      width: t.resize.width,
      height: t.resize.height,
    };
  }
  if (t.format.enabled) p.format = { target: t.format.target };
  if (t.stripExif) p.stripExif = true;
  if (t.compress.enabled) p.compress = { quality: t.compress.quality };
  return p;
}

export function ImageExtractorTool() {
  const { toast } = useToast();
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const [inputHtml, setInputHtml] = useState("");
  const [images, setImages] = useState<Record<string, ExtractedImage>>({});
  const [groups, setGroups] = useState<ImageGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [groupTransforms, setGroupTransforms] = useState<Record<string, GroupTransformOptions>>({});
  const [toolsOpen, setToolsOpen] = useState<Record<string, boolean>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [combineOpenGroupId, setCombineOpenGroupId] = useState<string | null>(null);
  const draggedImageId = useRef<string | null>(null);

  // Paste handler: passthrough, then read innerHTML (preserved from v1).
  useEffect(() => {
    const el = inputAreaRef.current;
    if (!el) return;
    const onPaste = () => {
      setTimeout(() => {
        const content = el.innerHTML;
        if (content.trim()) setInputHtml(content);
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

  // Extract + group on inputHtml change (debounced) — using v2 separator algorithm.
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
    setSelectedIds(new Set());
    setGroupTransforms({});
    setToolsOpen({});
  }, []);

  const getGroupTransforms = (gid: string): GroupTransformOptions =>
    groupTransforms[gid] ?? DEFAULT_GROUP_TRANSFORMS;
  const setGroupTransformsFor = (gid: string, t: GroupTransformOptions) =>
    setGroupTransforms((prev) => ({ ...prev, [gid]: t }));

  // Per-image original download (no transforms).
  const downloadOriginal = useCallback(
    (img: ExtractedImage) => {
      if (!img.blob) {
        toast({ title: "Cannot download", description: img.fetchError ?? "No image data", variant: "destructive" });
        return;
      }
      downloadImage(img.blob, img.filename);
    },
    [toast],
  );

  // Group Download all: apply group's transforms to each image, loop downloads.
  const downloadGroupAll = useCallback(
    async (gid: string) => {
      const group = groups.find((g) => g.id === gid);
      if (!group) return;
      const t = getGroupTransforms(gid);
      const pipeline = rebuildPipeline(t);
      const hasTransform = Object.keys(pipeline).length > 0;
      let skipped = 0;
      let downloaded = 0;
      for (const imgId of group.imageIds) {
        const img = images[imgId];
        if (!img || !img.blob) {
          skipped++;
          continue;
        }
        try {
          const out = hasTransform ? await applyTransforms(img.blob, pipeline) : img.blob;
          downloadImage(out, img.filename);
          downloaded++;
        } catch (e) {
          skipped++;
          console.error("transform failed for", img.filename, e);
        }
      }
      if (skipped > 0) {
        toast({
          title: `${downloaded} downloaded, ${skipped} skipped (fetch/transform failed)`,
          variant: skipped > downloaded ? "destructive" : "default",
        });
      } else if (downloaded > 0) {
        toast({ title: `${downloaded} downloaded` });
      }
    },
    [groups, images, getGroupTransforms, toast],
  );

  // Drag-drop between groups (preserved from v1, with v1 fix for empty groups).
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
    let sourceGroupId: string | null = null;
    for (const g of groups) {
      if (g.imageIds.includes(imgId)) {
        sourceGroupId = g.id;
        break;
      }
    }
    if (!sourceGroupId || sourceGroupId === targetGroupId) return;
    setGroups((prev) =>
      prev.flatMap((g) => {
        if (g.id === sourceGroupId) {
          const next = { ...g, imageIds: g.imageIds.filter((id) => id !== imgId) };
          return next.imageIds.length === 0 ? [] : [next];
        }
        if (g.id === targetGroupId) {
          return [{ ...g, imageIds: [...g.imageIds, imgId] }];
        }
        return [g];
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
      layoutHint: "horizontal",
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
    setGroups((prev) =>
      prev.flatMap((g) => {
        if (g.id === targetGroupId) {
          return [{ ...g, imageIds: [...g.imageIds, ...source.imageIds] }];
        }
        if (g.id === sourceGroupId) return [];
        return [g];
      }),
    );
  };

  // Compute the images for the open Combine modal (lazily).
  const combineGroup = combineOpenGroupId
    ? groups.find((g) => g.id === combineOpenGroupId) ?? null
    : null;
  const combineImages = combineGroup
    ? combineGroup.imageIds.map((id) => images[id]).filter((i): i is ExtractedImage => !!i)
    : [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* LEFT: paste area */}
      <Card className="flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">Input</CardTitle>
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
            className="flex-1 min-h-[300px] max-h-[60vh] p-4 text-sm bg-background border border-border rounded-lg overflow-auto focus:outline-none focus:ring-2 focus:ring-primary/20 input-editable"
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          />
          {loading && (
            <p className="mt-2 text-xs text-muted-foreground">Extracting images…</p>
          )}
        </CardContent>
      </Card>

      {/* RIGHT: extracted groups */}
      <Card className="flex flex-col">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">Extracted</CardTitle>
          <span className="text-xs text-muted-foreground">
            {Object.keys(images).length} image{Object.keys(images).length === 1 ? "" : "s"} ·{" "}
            {groups.length} group{groups.length === 1 ? "" : "s"}
          </span>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col gap-4">
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCombineOpenGroupId(g.id)}
                        className="h-7 px-2 text-xs"
                      >
                        Combine Images
                      </Button>
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

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
                            onClick={() => downloadOriginal(img)}
                            className="absolute bottom-1 right-1 bg-background/80 backdrop-blur p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Download original"
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

                  {/* Per-group Tools sub-panel (collapsible, optional). */}
                  <Collapsible
                    open={!!toolsOpen[g.id]}
                    onOpenChange={(o) =>
                      setToolsOpen((prev) => ({ ...prev, [g.id]: o }))
                    }
                    className="mt-3 border-t border-border/50 pt-2"
                  >
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="w-full justify-between">
                        Tools (optional — applied to Download all)
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${toolsOpen[g.id] ? "rotate-180" : ""}`}
                        />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                      <GroupTransformsPanel
                        gid={g.id}
                        transforms={getGroupTransforms(g.id)}
                        setTransforms={(t) => setGroupTransformsFor(g.id, t)}
                      />
                      <Button
                        onClick={() => downloadGroupAll(g.id)}
                        className="w-full mt-3"
                      >
                        Download all
                      </Button>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Image Combiner modal — mounts when a group's "Combine Images" is clicked. */}
      <ImageCombinerModal
        groupId={combineGroup?.id ?? ""}
        images={combineImages}
        open={!!combineOpenGroupId}
        onOpenChange={(o) => { if (!o) setCombineOpenGroupId(null); }}
      />

      {/* Layout fix: pasted images must render inline-by-default. */}
      <style>{`
        .input-editable img,
        .input-editable table,
        .input-editable p {
          display: inline-block !important;
          vertical-align: middle;
          max-width: 100%;
        }
      `}</style>
    </div>
  );
}

interface GroupTransformsPanelProps {
  gid: string;
  transforms: GroupTransformOptions;
  setTransforms: (t: GroupTransformOptions) => void;
}

function GroupTransformsPanel({ transforms, setTransforms }: GroupTransformsPanelProps) {
  const update = (patch: Partial<GroupTransformOptions>) =>
    setTransforms({ ...transforms, ...patch });
  return (
    <div className="space-y-2 text-xs">
      <FieldRow
        label="Compress"
        enabled={transforms.compress.enabled}
        onToggle={(v) =>
          update({ compress: { quality: 80, ...transforms.compress, enabled: v } })
        }
      >
        <Input
          type="number"
          min={1}
          max={100}
          value={transforms.compress.quality}
          onChange={(e) =>
            update({ compress: { ...transforms.compress!, quality: Number(e.target.value) } })
          }
          className="w-20 h-7"
          disabled={!transforms.compress.enabled}
        />
      </FieldRow>
      <FieldRow
        label="Format"
        enabled={transforms.format.enabled}
        onToggle={(v) =>
          update({ format: { target: "png", ...transforms.format, enabled: v } })
        }
      >
        <select
          value={transforms.format.target}
          onChange={(e) =>
            update({ format: { ...transforms.format!, target: e.target.value as TargetFormat } })
          }
          className="h-7 bg-background border border-border rounded px-2"
          disabled={!transforms.format.enabled}
        >
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
          <option value="webp">WebP</option>
        </select>
      </FieldRow>
      <FieldRow
        label="Resize"
        enabled={transforms.resize.enabled}
        onToggle={(v) =>
          update({ resize: { mode: "exact", ...transforms.resize, enabled: v } })
        }
      >
        <div className="flex items-center gap-1">
          <Input
            type="number"
            placeholder="W"
            value={transforms.resize.width ?? ""}
            onChange={(e) =>
              update({
                resize: {
                  ...transforms.resize!,
                  width: e.target.value ? Number(e.target.value) : undefined,
                },
              })
            }
            className="w-16 h-7"
            disabled={!transforms.resize.enabled}
          />
          <span>×</span>
          <Input
            type="number"
            placeholder="H"
            value={transforms.resize.height ?? ""}
            onChange={(e) =>
              update({
                resize: {
                  ...transforms.resize!,
                  height: e.target.value ? Number(e.target.value) : undefined,
                },
              })
            }
            className="w-16 h-7"
            disabled={!transforms.resize.enabled}
          />
        </div>
      </FieldRow>
      <FieldRow
        label="Upscale"
        enabled={transforms.upscale.enabled}
        onToggle={(v) =>
          update({ upscale: { factor: 2, ...transforms.upscale, enabled: v } })
        }
      >
        <select
          value={transforms.upscale.factor}
          onChange={(e) =>
            update({ upscale: { ...transforms.upscale!, factor: Number(e.target.value) as 1.5 | 2 | 3 | 4 } })
          }
          className="h-7 bg-background border border-border rounded px-2"
          disabled={!transforms.upscale.enabled}
        >
          <option value={1.5}>1.5×</option>
          <option value={2}>2×</option>
          <option value={3}>3×</option>
          <option value={4}>4×</option>
        </select>
      </FieldRow>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`strip-exif-${transforms ? "x" : "y"}`}
          checked={transforms.stripExif}
          onCheckedChange={(v) => update({ stripExif: !!v })}
        />
        <Label className="text-xs">Strip EXIF / metadata</Label>
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
  children: ReactNode;
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