"use client";

import { useState, type MouseEvent } from "react";
import {
  clampNumber,
  computeLogoPlacementRect,
  type LogoPlacementConfig,
} from "@/lib/marketing-drive";
import { cn } from "@/lib/utils";

export function BrandedArtworkPreview({
  artworkUrl,
  alt,
  applyLogo,
  config,
  opacity,
  logoUrl,
  brandName,
  brandPrimary = "#0f172a",
  interactive = false,
  onPickCustomPosition,
  className,
}: {
  artworkUrl: string;
  alt: string;
  applyLogo: boolean;
  config: LogoPlacementConfig;
  opacity: number;
  logoUrl: string | null;
  brandName: string;
  brandPrimary?: string;
  interactive?: boolean;
  onPickCustomPosition?: (xPct: number, yPct: number) => void;
  className?: string;
}) {
  const [artDims, setArtDims] = useState<{ w: number; h: number }>({ w: 1080, h: 1080 });
  const [logoDims, setLogoDims] = useState<{ w: number; h: number }>({ w: 320, h: 96 });

  const hasImageLogo = Boolean(logoUrl);
  const effectiveBackdrop =
    !hasImageLogo && config.logoBackdrop === "none" ? "dark" : config.logoBackdrop;

  const rect = computeLogoPlacementRect({
    artworkWidth: artDims.w,
    artworkHeight: artDims.h,
    logoNaturalWidth: hasImageLogo ? logoDims.w : 320,
    logoNaturalHeight: hasImageLogo ? logoDims.h : 90,
    config: {
      ...config,
      logoBackdrop: effectiveBackdrop,
    },
  });

  const leftPct = (rect.boxX / artDims.w) * 100;
  const topPct = (rect.boxY / artDims.h) * 100;
  const widthPct = (rect.boxWidth / artDims.w) * 100;
  const heightPct = (rect.boxHeight / artDims.h) * 100;
  const padXPct = rect.boxWidth > 0 ? ((rect.logoX - rect.boxX) / rect.boxWidth) * 100 : 0;
  const padYPct = rect.boxHeight > 0 ? ((rect.logoY - rect.boxY) / rect.boxHeight) * 100 : 0;

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    if (!interactive || !onPickCustomPosition) return;
    const bounds = e.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const xPct = clampNumber(((e.clientX - bounds.left) / bounds.width) * 100, 5, 95, 88);
    const yPct = clampNumber(((e.clientY - bounds.top) / bounds.height) * 100, 5, 95, 88);
    onPickCustomPosition(Math.round(xPct * 10) / 10, Math.round(yPct * 10) / 10);
  }

  return (
    <div
      onClick={handleClick}
      className={cn(
        "relative inline-block overflow-hidden select-none",
        interactive ? "cursor-crosshair" : "",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={artworkUrl}
        alt={alt}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth && img.naturalHeight) {
            setArtDims({ w: img.naturalWidth, h: img.naturalHeight });
          }
        }}
        className="block h-full w-full object-contain"
      />

      {applyLogo ? (
        <div
          style={{
            left: `${leftPct}%`,
            top: `${topPct}%`,
            width: `${widthPct}%`,
            height: `${heightPct}%`,
            opacity: clampNumber(opacity, 30, 100, 100) / 100,
            padding: `${padYPct}% ${padXPct}%`,
          }}
          className={cn(
            "pointer-events-none absolute flex items-center justify-center overflow-hidden rounded-lg",
            effectiveBackdrop === "light" && "border border-slate-900/10 bg-white/90 shadow-xs",
            effectiveBackdrop === "dark" && "border border-white/15 bg-slate-900/85 shadow-xs",
            interactive && "ring-2 ring-blue-500/80 ring-offset-1",
          )}
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={brandName}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth && img.naturalHeight) {
                  setLogoDims({ w: img.naturalWidth, h: img.naturalHeight });
                }
              }}
              className="h-full w-full object-contain"
            />
          ) : (
            <span
              style={{ color: effectiveBackdrop === "light" ? brandPrimary : "#ffffff" }}
              className="truncate px-1 text-center text-[10px] font-bold tracking-tight sm:text-xs"
            >
              {brandName}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
