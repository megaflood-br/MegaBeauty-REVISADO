"use client";

import {
  clampNumber,
  computeLogoPlacementRect,
  sanitizeDownloadFilename,
  type LogoBackdropStyle,
  type LogoPlacementConfig,
} from "@/lib/marketing-drive";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Não foi possível carregar a imagem para personalizar."));
    img.src = src;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  backdrop: LogoBackdropStyle,
  rect: { boxX: number; boxY: number; boxWidth: number; boxHeight: number; boxRadius: number },
) {
  if (backdrop === "none") return;
  ctx.save();
  drawRoundedRect(ctx, rect.boxX, rect.boxY, rect.boxWidth, rect.boxHeight, rect.boxRadius);
  if (backdrop === "light") {
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(15, 23, 42, 0.08)";
    ctx.lineWidth = Math.max(1, Math.round(rect.boxHeight * 0.02));
    ctx.stroke();
  } else {
    ctx.fillStyle = "rgba(15, 23, 42, 0.84)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = Math.max(1, Math.round(rect.boxHeight * 0.02));
    ctx.stroke();
  }
  ctx.restore();
}

export async function downloadBrandedArtwork(args: {
  artworkUrl: string;
  title: string;
  brandName: string;
  brandPrimary?: string;
  logoUrl: string | null;
  applyLogo: boolean;
  config: LogoPlacementConfig;
  opacity: number;
  outputFormat?: "png" | "jpeg";
}): Promise<void> {
  const artworkImg = await loadImage(args.artworkUrl);
  const artW = artworkImg.naturalWidth || artworkImg.width;
  const artH = artworkImg.naturalHeight || artworkImg.height;
  if (!artW || !artH) {
    throw new Error("Dimensões da imagem inválidas.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = artW;
  canvas.height = artH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Seu navegador não suportou a renderização da arte.");
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(artworkImg, 0, 0, artW, artH);

  if (args.applyLogo) {
    const alpha = clampNumber(args.opacity, 30, 100, 100) / 100;

    if (args.logoUrl) {
      const logoImg = await loadImage(args.logoUrl);
      const rect = computeLogoPlacementRect({
        artworkWidth: artW,
        artworkHeight: artH,
        logoNaturalWidth: logoImg.naturalWidth || logoImg.width,
        logoNaturalHeight: logoImg.naturalHeight || logoImg.height,
        config: args.config,
      });

      ctx.save();
      ctx.globalAlpha = alpha;
      drawBackdrop(ctx, args.config.logoBackdrop, rect);
      ctx.drawImage(logoImg, rect.logoX, rect.logoY, rect.logoWidth, rect.logoHeight);
      ctx.restore();
    } else if (args.brandName.trim()) {
      // Fallback typographic brand badge when partner has not uploaded a logo file yet
      const rect = computeLogoPlacementRect({
        artworkWidth: artW,
        artworkHeight: artH,
        logoNaturalWidth: 320,
        logoNaturalHeight: 90,
        config: {
          ...args.config,
          logoBackdrop: args.config.logoBackdrop === "none" ? "dark" : args.config.logoBackdrop,
        },
      });
      const effectiveBackdrop = args.config.logoBackdrop === "none" ? "dark" : args.config.logoBackdrop;

      ctx.save();
      ctx.globalAlpha = alpha;
      drawBackdrop(ctx, effectiveBackdrop, rect);
      const label = args.brandName.trim().slice(0, 28);
      let fontSize = Math.max(14, Math.round(rect.logoHeight * 0.56));
      ctx.font = `700 ${fontSize}px Inter, system-ui, -apple-system, sans-serif`;
      const measured = ctx.measureText(label).width;
      if (measured > rect.logoWidth * 0.92 && measured > 0) {
        fontSize = Math.max(12, Math.floor(fontSize * ((rect.logoWidth * 0.92) / measured)));
        ctx.font = `700 ${fontSize}px Inter, system-ui, -apple-system, sans-serif`;
      }
      ctx.fillStyle = effectiveBackdrop === "light" ? args.brandPrimary || "#0f172a" : "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, rect.boxX + rect.boxWidth / 2, rect.boxY + rect.boxHeight / 2);
      ctx.restore();
    }
  }

  const format = args.outputFormat ?? "png";
  const mime = format === "jpeg" ? "image/jpeg" : "image/png";
  const quality = format === "jpeg" ? 0.94 : undefined;

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
  if (!blob) {
    throw new Error("Não foi possível gerar o arquivo final da arte.");
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const suffix = args.applyLogo ? `${args.title}-${args.brandName}` : args.title;
  link.download = sanitizeDownloadFilename(suffix, format === "jpeg" ? ".jpg" : ".png");
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
