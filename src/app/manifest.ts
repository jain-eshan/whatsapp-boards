import type { MetadataRoute } from "next";

/**
 * PWA manifest — the second front door (share target) and what makes the
 * web app installable rather than just a bookmark. See plan §The web app
 * is the product surface.
 *
 * share_target: Android's share sheet posts here (Share → this app from a
 * long-pressed WhatsApp message) into /api/share, feeding the same ingest
 * pipeline as WhatsApp DM capture. iOS PWAs cannot register as share
 * targets — that's an iOS Shortcut instead, documented in the README, not
 * a gap in this file.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Boards",
    short_name: "Boards",
    description: "Capture from WhatsApp, organize and search here.",
    start_url: "/boards",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    // share_target is not yet in Next's typed Manifest shape; the field is
    // valid per the Web Manifest spec and Chrome honors it regardless.
    ...({
      share_target: {
        action: "/api/share",
        method: "POST",
        enctype: "multipart/form-data",
        params: { title: "title", text: "text", url: "url" },
      },
    } as Record<string, unknown>),
  };
}
