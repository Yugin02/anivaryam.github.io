import { useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { loadZipAsHtml } from "@/lib/image-extractor/load-zip";

interface ImageExtractorZipDropProps {
  onHtmlLoaded: (html: string) => void;
}

export function ImageExtractorZipDrop({ onHtmlLoaded }: ImageExtractorZipDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const dragCounter = useRef(0);

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isLoading) return;
    dragCounter.current += 1;
    if (dragCounter.current === 1) setIsDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragOver(false);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast({
        title: "Invalid file",
        description: "Please drop a .zip file exported from Google Docs.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    try {
      const html = await loadZipAsHtml(file);
      onHtmlLoaded(html);
      toast({
        title: "Zip loaded",
        description: `Loaded ${file.name} from zip archive.`,
      });
    } catch (e) {
      toast({
        title: "Failed to load zip",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragOver(false);
    if (isLoading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  };

  return (
    <Card
      className={`relative border-dashed transition-colors ${
        isDragOver ? "border-primary bg-primary/5" : "border-border"
      } ${isLoading ? "opacity-60 pointer-events-none" : "cursor-pointer"}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-testid="zip-dropzone"
    >
      <CardContent className="flex flex-col items-center justify-center gap-2 py-6 text-center">
        {isLoading ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <Upload className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        )}
        <p className="text-sm font-medium">
          {isLoading ? "Loading zip…" : "Drop a .zip file here, or click to browse"}
        </p>
        <p className="text-xs text-muted-foreground">
          Use Google Docs → File → Download → Web Page (.zip)
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".zip"
          onChange={onInputChange}
          disabled={isLoading}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          aria-label="Upload Google Docs zip file"
        />
      </CardContent>
    </Card>
  );
}
