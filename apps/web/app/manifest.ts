import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Modular CRM",
    short_name: "Modular",
    description: "Your service business, in one place",
    start_url: "/field/today",
    display: "standalone",
    background_color: "#f6f7f3",
    theme_color: "#153d34",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
