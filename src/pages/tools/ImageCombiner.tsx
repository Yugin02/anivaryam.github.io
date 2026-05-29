import { useState, useEffect } from "react";
import { Layout } from "@/components/layout/Layout";
import { SEO } from "@/components/SEO";
import { ImageCombinerTool } from "@/components/tools/ImageCombinerTool";
import { UpdateNotification } from "@/components/UpdateNotification";
import { Combine, Home, ChevronUp } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed bottom-6 right-6 z-50 rounded-full bg-primary text-primary-foreground shadow-lg p-3 hover:bg-primary/90 transition-opacity"
      aria-label="Scroll to top"
    >
      <ChevronUp className="h-5 w-5" />
    </button>
  );
}

export default function ImageCombinerPage() {
  return (
    <Layout>
      <SEO
        title="Image Combiner — Combine Multiple Images into One"
        description="Free online image combiner tool. Upload multiple images, arrange them horizontally, vertically, or in a grid, adjust spacing and padding, and download as PNG, JPEG, or WebP. All processing happens in your browser."
        canonical="https://anivaryam.github.io/tools/image-combiner"
        breadcrumbs={[
          { name: "Home", url: "https://anivaryam.github.io/" },
          { name: "Tools", url: "https://anivaryam.github.io/tools" },
          { name: "Image Combiner", url: "https://anivaryam.github.io/tools/image-combiner" },
        ]}
        structuredData={{
          type: "SoftwareApplication",
          applicationCategory: "DeveloperApplication",
          operatingSystem: "Web Browser",
          offers: {
            price: "0",
            priceCurrency: "USD",
          },
        }}
      />
      <div className="container mx-auto px-4 py-12">
        <ScrollToTop />
        <UpdateNotification />

        <Breadcrumb className="mb-8">
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/" className="flex items-center gap-1">
                  <Home className="h-4 w-4" />
                  Home
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/tools">Tools</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Image Combiner</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent-foreground text-sm font-mono mb-4">
            <Combine className="h-4 w-4" />
            Online Tools
          </div>
          <h1 className="text-3xl lg:text-4xl font-bold mb-4">
            Image Combiner
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm">
            Upload multiple images, arrange them horizontally, vertically, or in a grid, adjust spacing and padding, then download the combined result.
          </p>
        </div>

        <div className="max-w-5xl mx-auto">
          <ImageCombinerTool />
        </div>

        <div className="mt-8">
          <div className="prose prose-sm max-w-none text-muted-foreground">
            <h2 className="text-xl font-semibold mb-4 text-foreground">About This Tool</h2>
            <p>
              Combine multiple images into a single image instantly with this free online tool. Perfect for creating photo collages, social media graphics, blog headers, product grids, and more. Arrange images in rows or columns, set the spacing between images, and add padding around the edges. Choose your preferred output format — PNG for transparency, JPEG for smaller file sizes, or WebP for modern browsers. All processing happens entirely in your browser — your images never leave your device, ensuring complete privacy.
            </p>
          </div>
        </div>
      </div>
    </Layout>
  );
}
