# Image Extractor v2 — Design

**Status:** Draft (awaiting user approval of written spec)
**Date:** 2026-07-30
**Author:** Sisyphus
**Existing plan:** `docs/superpowers/plans/2026-07-30-image-extractor.md` (v1, all 9 tasks complete and merged)
**Existing spec:** `docs/superpowers/specs/2026-07-30-image-extractor-design.md` (v1)

## Purpose

Iterate the shipped Image Extractor tool based on user testing feedback. Four concrete issues identified after v1 shipped:

1. **Layout bug:** Pasted images stack vertically because source HTML's `display: block` styles win over the contenteditable's defaults.
2. **Grouping algorithm:** User wants groups defined by `<p>` / `<strong>` / `<ul>` / `<li>` / `<ol>` / `<h1>`–`<h5>` separators — i.e., "images between text" — rather than the current DOM-layout heuristic.
3. **Tool UX:** Replace the global "Transform settings" panel (which auto-applies to all downloads) with per-group tools that are explicitly optional.
4. **Image Combiner integration:** Expose the existing `<ImageCombinerTool>` as a per-group action that opens in a modal.

## Non-Goals

- No new npm dependencies (use existing `<Dialog>` from `src/components/ui/dialog`).
- No refactor of `<ImageCombinerTool>` — used as-is inside the modal.
- No ZIP / bundle downloads (carried over from v1).
- No undo/redo, error reporting, telemetry.
- No `.docx` parsing (mammoth remains unused as in v1).

## Decisions (locked via brainstorming 2026-07-30)

1. **Algorithm:** Groups form by walking the source DOM in document order. Separator elements (`<p>`, `<strong>`, `<ul>`, `<ol>`, `<li>`, `<h1>`–`<h5>`) close the current group and start a new one. All other elements (`div`, `span`, `table`, `br`, `section`, `article`, `main`, etc.) descend through for nested images. Empty groups are dropped.
2. **Tool placement:** Each group has its own collapsible "Tools" sub-panel (compress / format / resize / stripExif / upscale). Tools are optional. No global panel.
3. **Per-group modal:** Click "Combine Images" → opens a `<Dialog>` containing the existing `<ImageCombinerTool>` with the group's images pre-loaded. Modal closes back to the unmodified group (Approach A from brainstorming).
4. **Per-image Download:** Each image card has its own Download icon that downloads the original blob (no transforms).
5. **Group Download:** The group's "Download all" button applies the group's transform sub-panel settings to each image and downloads each as a separate file. Skips failed blobs with a toast count.

## Architecture

**File map:**

| Path | Type | Lines | Responsibility |
|---|---|---|---|
| `src/lib/image-extractor/grouping.ts` | MODIFY | ~120 | `groupImages(images, sourceDoc)` rewritten with separator-based algorithm |
| `src/components/tools/ImageExtractorTool.tsx` | MODIFY | ~700 | CSS fix #1 in inline `<style>`; remove global TransformsPanel; add per-group transforms sub-panel; per-image Download icon; Combine Images button + Modal |
| `src/components/tools/ImageCombinerModal.tsx` | NEW | ~80 | `<Dialog>` wrapper around `<ImageCombinerTool>` with the group's images pre-loaded |
| `src/lib/image-extractor/grouping.test.ts` | MODIFY | ~120 | Updated tests for new algorithm; covers all separator elements |

**Reused from v1 (no changes):**
- `src/lib/image-extractor/extractor.ts` (image extraction)
- `src/lib/image-transforms/transforms.ts` (compress / convert / upscale / stripExif / applyTransforms)
- `src/components/tools/ImageCombinerTool.tsx` (used as-is)
- `src/pages/tools/ImageExtractor.tsx`, `src/App.tsx` routes, all SEO wiring

**No new dependencies.**

## Components & state

### `ImageExtractorTool.tsx` — rewritten top-level component

**State diff:**
```ts
// REMOVED (carried over from v1):
const [transforms, setTransforms] = useState<TransformOptions>(DEFAULT_TRANSFORMS);
const [settingsOpen, setSettingsOpen] = useState(true);

// ADDED:
const [groupTransforms, setGroupTransforms] = useState<Record<string, GroupTransformOptions>>({});
const [combineOpenGroupId, setCombineOpenGroupId] = useState<string | null>(null);
```

`GroupTransformOptions` — same shape as v1's `TransformOptions` (compress / format / resize / stripExif / upscale), scoped per-group via `groupId` key.

**Per-group card layout (visual):**

```
┌─ Group 1 · vertical ──────────── [⌃ Combine Images] [⇅ Merge] ─┐
│                                                                │
│  ┌──img 1──┐  ┌──img 2──┐  [per-image ↓ on each]            │
│                                                                │
│  ─── Tools (optional) ──  [▾ toggle]                            │
│  [x] Compress [────●──] 80                                     │
│  [ ] Format    [ PNG ▾ ]                                       │
│  [ ] Resize    [   ]×[   ]                                     │
│  [ ] Strip EXIF                                                 │
│                                                                │
│  [ Download all ]                                              │
└────────────────────────────────────────────────────────────────┘
```

**Behaviors:**
- **Per-image `↓` icon:** Downloads that one image's original blob. No transforms. No group-level batch.
- **Combine Images button:** `setCombineOpenGroupId(g.id)`. Opens modal.
- **Tools toggle:** Collapsed by default. When expanded, contains compress / format / resize / strip-EXIF checkboxes (mirroring v1's TransformsPanel but compact).
- **Download all button:** Iterates images in group, skips failed blobs (toast count), applies group's transforms via `applyTransforms(blob, groupTransforms[gid])`, downloads each. May trigger browser multi-download prompt — acceptable per v1's no-ZIP decision.
- **Existing drag/split/merge buttons** preserved from v1.

### `ImageCombinerModal.tsx` — new component

**Props:**
```ts
interface ImageCombinerModalProps {
  groupId: string;
  images: ExtractedImage[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

**Body:** shadcn `<Dialog>` with `<DialogContent className="max-w-5xl">`. Inside, renders existing `<ImageCombinerTool images={images} />`. Wraps the `<ImageCombinerTool>` in a local `<ErrorBoundary>` whose fallback is a small dismiss panel so a thrown combiner error doesn't break the whole modal.

**No state coupling with the parent group:** Closing the modal does not modify the group state. ImageCombiner's internal state is destroyed on unmount.

### `grouping.ts` — rewritten `groupImages`

**Algorithm:**
```
function groupImages(images, sourceDoc) {
  // 1. Initialize: groups = [], currentGroupImages = []
  // 2. Walk sourceDoc's body in document order (TreeWalker or recursive).
  // 3. For each node:
  //    a. If node is <img>:
  //       - Look up the matching ExtractedImage by src match + DOM order fallback.
  //       - Push imgId onto currentGroupImages.
  //    b. Else if node.tagName ∈ {P, STRONG, UL, OL, LI, H1, H2, H3, H4, H5}:
  //       - If currentGroupImages.length > 0: close current group, start new.
  //       - Do NOT descend into the separator's children for image collection at this level.
  //         (Images INSIDE the separator's subtree start a new group per the recursion rule.)
  //    c. Else (DIV, SPAN, TABLE, BR, SECTION, ARTICLE, MAIN, etc.):
  //       - Descend into children for image collection.
  // 4. After walk: close final group.
  // 5. Drop empty groups.
  // 6. Return ImageGroup[] with layoutHint:
  //    - single-image group → "horizontal"
  //    - multi-image group with all images in same separator-block → "horizontal"
  //    - multi-image group formed across separator transitions → "vertical"
  //    - table-formed group → "grid"
  //    Default to "horizontal" when undetermined.
}
```

This rewrites the v1 algorithm, which was based on "smallest common ancestor." The new algorithm walks in source order and segments by separators.

**Edge cases handled:**
- No `<img>` in source → `[]`.
- Empty input HTML → `[]`.
- Images only, no separators anywhere → single group.
- Two images in same `<p>` → 1 group.
- Adjacent `<p><img/></p><p><img/></p>` → 2 groups (each `<p>` closes the prior group; second `<p>` opens a fresh group containing its image).
- `<strong>` between two `<img>` siblings → 2 groups (STRONG is in separator list).
- `<br>` between two images → 1 group (BR is not a separator).
- Image in `<table>` → same group as other table images (TABLE is not a separator).
- Single image group → emits; not dropped, even though empty sibling check would normally skip.

### Inline CSS fix in `ImageExtractorTool.tsx` `<style>` block

Adds:
```css
.input-editable img,
.input-editable table,
.input-editable p {
  display: inline-block !important;
  vertical-align: middle;
  max-width: 100%;
}
```

This overrides the source HTML's `display: block` and forces images to render inline-by-default, fixing the layout bug from issue #1. Preserves image extraction (the paste handler still reads `innerHTML` and srcs survive).

## Data flow

1. User pastes HTML into the contenteditable input area.
2. CSS override forces pasted images to render inline-by-default (layout fix).
3. Paste handler reads `inputArea.innerHTML` → `setInputHtml(html)`.
4. `useEffect` runs extract + grouping:
   - `extractImages(html)` returns `ExtractedImage[]` (unchanged from v1).
   - `groupImages(images, sourceDoc)` returns `ImageGroup[]` with the new separator algorithm.
5. UI renders groups, each with: image thumbs + per-image Download + Combine Images button + collapsible Tools sub-panel + Download all.
6. **Per-image Download:** `downloadImage(image.blob, image.filename)` — original blob, no transforms.
7. **Per-group Download all:** For each image in group: skip if `blob == null`; else `applyTransforms(blob, groupTransforms[gid])` → `downloadImage(transformed, filename)`. Toast count of skipped.
8. **Combine Images:** Click → `setCombineOpenGroupId(g.id)` → opens `<ImageCombinerModal>` → modal renders `<ImageCombinerTool>` with the group's images. User arranges, picks output format, downloads combined image from within the modal. Close modal → group state unchanged.
9. **Drag/split/merge** — unchanged from v1.

## Error handling

| Scenario | Behavior |
|---|---|
| Empty / non-HTML paste | Placeholder visible; no group area |
| Image fetch fails (CORS/expired/404) | Error card visible per image; download buttons disabled, toast on click |
| Blob transform fails | Toast: "Transform failed — downloading original"; falls back to original blob |
| Invalid drop target | Image snaps back to origin group |
| Group becomes empty after drag | Auto-removes from rendered list (v1 Important fix, preserved) |
| Decoded data URI is malformed | Skip image; aggregate toast "Skipped N malformed images" |
| Clipboard image paste (screenshot) | Detected via `e.clipboardData.items`; each becomes single-image group labeled "Pasted Image N" |
| ImageCombinerTool throws inside modal | Local `<ErrorBoundary>` catches; renders fallback dismiss panel. Group state unchanged. |
| User closes modal mid-combiner-process | Modal unmounts ImageCombinerTool; React cleanup. No data propagated to parent. |
| User clicks Download all with some failed blobs in the group | Skip failed blobs; toast: "X image(s) skipped (fetch failed), Y downloaded" |
| Per-image Download on a failed image | Toast: "Cannot download" + the `fetchError` text. Existing v1 behavior. |
| No groups after extraction (only separators found) | Empty `groups` array → placeholder displays. No crash. |
| Modal opens with empty images array | ImageCombinerTool's existing 0-image UI handles; modal renders and closes normally. |

## Testing

### Unit tests (`grouping.test.ts` — rewritten)

New fixtures for the separator-based algorithm:

| Input | Expected groups |
|---|---|
| 1 image in `<div>` | 1 group |
| 2 images in same `<p>` | 1 group, `layoutHint: 'horizontal'` |
| 3 images each in own `<p>` | **3 groups** (algorithm change from v1) |
| 2 images in `<p>`, 1 in `<strong>` | 2 groups (P and STRONG both separate) |
| 1 image in `<ul><li>` | 1 group (LI separates from prior, but only one image here) |
| 2 images separated by `<br>` | 1 group (BR not a separator) |
| 2 images separated by `<span>` | 1 group (SPAN not a separator) |
| 2 images inside `<table><tr>` | 1 group (TABLE descends) |
| 5 images each after one of `<h1>`–`<h5>` | 6 groups (5 separators + dangling group) |
| 4 images: `<p>img1</p>img2<ul><li>img3</li></ul>img4` | 4 groups (each separator creates a new group) |
| Empty `images[]` | `[]` |
| No `<img>` in source | `[]` |

Total: 12 fixtures. Plus: image order preserved within a group; single-image group has `layoutHint: 'horizontal'`.

### Unit tests (other suites — unchanged)

- `extractor.test.ts` — 8 tests (unchanged from v1).
- `transforms.test.ts` — 7 tests (1 WebP conditional skip, unchanged).
- **Expected total after v2:** 12 + 8 + 7 = 27 tests across 3 files.

### Manual smoke (verified by user)

**Layout fix:**
- Paste Google Docs with 4-image grid → images render inline-by-default in input area (NOT stacked vertically).
- Paste Word `.docx` with vertical 3-image list → images render side-by-side as width allows.

**Grouping:**
- `<p><img></p><p><img></p>` paste → **2 groups**.
- `<p>text<img>more text<img>text</p>` → 1 group.
- `<strong>img1</strong>img2` → 2 groups.

**UI redesign:**
- Per-image Download icon → downloads that one original blob.
- "Combine Images" → opens ImageCombinerTool modal → use it → download combined → close → group unchanged.
- Group "Tools" sub-panel set values → "Download all" → images downloaded with transforms applied; failed blobs skipped with toast.
- Global TransformsPanel removed.

**Regression:**
- All v1 fixes preserved: empty groups after drag (Important fix), per-image error cards, malformed URI toast aggregate, drag/split/merge buttons.
- 20/20 v1 tests still pass.

## Implementation order

1. `src/lib/image-extractor/grouping.ts` — rewrite algorithm.
2. `src/lib/image-extractor/grouping.test.ts` — rewrite tests.
3. `src/components/tools/ImageCombinerModal.tsx` — new file.
4. `src/components/tools/ImageExtractorTool.tsx` — top-level rewrite with CSS fix, per-group transforms, modal wiring.
5. Manual smoke (verified by user; the sub-agent for the implementation does not need to run a browser).
6. Final verification: `npm test && npm run lint && npm run build`.

## Open questions

None at design time. All 4 user-reported issues addressed in the brainstorming session 2026-07-30.
