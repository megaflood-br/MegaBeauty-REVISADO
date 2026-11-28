"use client";

import {
  getStudioFormatDef,
  type StudioFormatId,
  type StudioStyleId,
} from "@/lib/marketing-studio";

export type StudioCanvasInput = {
  format: StudioFormatId;
  style: StudioStyleId;
  backgroundUrl: string | null;
  logoUrl: string | null;
  salonName: string;
  accentColor: string;
  badgeText: string;
  headline: string;
  subline: string;
  priceText: string;
  promoPriceText: string;
  dateRangeText: string;
  ctaText: string;
  phone: string;
};

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    if (!src.startsWith("data:") && !src.startsWith("blob:")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
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

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  targetX: number,
  targetY: number,
  targetW: number,
  targetH: number,
) {
  const imgRatio = img.naturalWidth / Math.max(1, img.naturalHeight);
  const boxRatio = targetW / Math.max(1, targetH);
  let sx = 0;
  let sy = 0;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (imgRatio > boxRatio) {
    sw = img.naturalHeight * boxRatio;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / boxRatio;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, targetX, targetY, targetW, targetH);
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
      if (lines.length === maxLines - 1) {
        const rest = words.slice(i).join(" ");
        let trimmed = rest;
        while (trimmed.length > 3 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
          trimmed = trimmed.slice(0, -1).trimEnd();
        }
        lines.push(trimmed === rest ? trimmed : `${trimmed}…`);
        return lines;
      }
    }
  }
  lines.push(current);
  return lines;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean.padEnd(6, "0").slice(0, 6);
  const num = Number.parseInt(full, 16);
  if (!Number.isFinite(num)) return { r: 37, g: 99, b: 235 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export async function renderMarketingArtworkToCanvas(
  canvas: HTMLCanvasElement,
  input: StudioCanvasInput,
): Promise<void> {
  const formatDef = getStudioFormatDef(input.format);
  const W = formatDef.width;
  const H = formatDef.height;
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const accent = /^#[0-9a-fA-F]{3,6}$/.test(input.accentColor) ? input.accentColor : "#2563EB";
  const rgb = hexToRgb(accent);
  const isStory = input.format === "story";
  const isMinimal = input.style === "minimal";
  const isFlash = input.style === "flash";
  const isGlow = input.style === "glow";

  const [bgImg, logoImg] = await Promise.all([
    input.backgroundUrl ? loadImage(input.backgroundUrl) : Promise.resolve(null),
    input.logoUrl ? loadImage(input.logoUrl) : Promise.resolve(null),
  ]);

  // 1. Background layer
  if (bgImg) {
    drawCoverImage(ctx, bgImg, 0, 0, W, H);
  } else {
    const grad = ctx.createLinearGradient(0, 0, W, H);
    if (isMinimal) {
      grad.addColorStop(0, "#f8fafc");
      grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)`);
    } else if (isGlow) {
      grad.addColorStop(0, `rgb(${Math.max(20, rgb.r - 40)}, ${Math.max(20, rgb.g - 40)}, ${Math.max(20, rgb.b - 40)})`);
      grad.addColorStop(0.55, "#1e1b4b");
      grad.addColorStop(1, "#0f172a");
    } else if (isFlash) {
      grad.addColorStop(0, "#111827");
      grad.addColorStop(0.55, `rgb(${Math.min(255, rgb.r)}, ${Math.min(255, rgb.g)}, ${Math.min(255, rgb.b)})`);
      grad.addColorStop(1, "#09090b");
    } else {
      grad.addColorStop(0, "#0f172a");
      grad.addColorStop(0.6, "#1e293b");
      grad.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.85)`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Subtle editorial light orbs
    const orb1 = ctx.createRadialGradient(W * 0.82, H * 0.18, 20, W * 0.82, H * 0.18, W * 0.55);
    orb1.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isMinimal ? 0.18 : 0.35})`);
    orb1.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = orb1;
    ctx.fillRect(0, 0, W, H);
  }

  // 2. Scrim overlay for contrast & readability
  if (isMinimal) {
    const topScrim = ctx.createLinearGradient(0, 0, 0, H * 0.35);
    topScrim.addColorStop(0, "rgba(15, 23, 42, 0.58)");
    topScrim.addColorStop(1, "rgba(15, 23, 42, 0)");
    ctx.fillStyle = topScrim;
    ctx.fillRect(0, 0, W, H * 0.35);

    const botScrim = ctx.createLinearGradient(0, H * 0.45, 0, H);
    botScrim.addColorStop(0, "rgba(15, 23, 42, 0)");
    botScrim.addColorStop(1, "rgba(15, 23, 42, 0.48)");
    ctx.fillStyle = botScrim;
    ctx.fillRect(0, H * 0.45, W, H * 0.55);
  } else {
    const fullScrim = ctx.createLinearGradient(0, 0, 0, H);
    if (isGlow) {
      fullScrim.addColorStop(0, "rgba(15, 23, 42, 0.46)");
      fullScrim.addColorStop(0.42, "rgba(15, 23, 42, 0.20)");
      fullScrim.addColorStop(0.76, `rgba(${Math.round(rgb.r * 0.35)}, ${Math.round(rgb.g * 0.35)}, ${Math.round(rgb.b * 0.35)}, 0.86)`);
      fullScrim.addColorStop(1, "rgba(9, 13, 28, 0.96)");
    } else if (isFlash) {
      fullScrim.addColorStop(0, "rgba(9, 9, 11, 0.52)");
      fullScrim.addColorStop(0.4, "rgba(9, 9, 11, 0.22)");
      fullScrim.addColorStop(0.74, "rgba(9, 9, 11, 0.86)");
      fullScrim.addColorStop(1, "rgba(9, 9, 11, 0.96)");
    } else {
      fullScrim.addColorStop(0, "rgba(15, 23, 42, 0.48)");
      fullScrim.addColorStop(0.45, "rgba(15, 23, 42, 0.16)");
      fullScrim.addColorStop(0.76, "rgba(15, 23, 42, 0.84)");
      fullScrim.addColorStop(1, "rgba(2, 6, 23, 0.95)");
    }
    ctx.fillStyle = fullScrim;
    ctx.fillRect(0, 0, W, H);
  }

  // Subtle decorative border frame for Editorial style
  if (input.style === "editorial") {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.20)";
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, 36, 36, W - 72, H - 72, 28);
    ctx.stroke();
  }

  const padX = 76;
  const topY = isStory ? 116 : 74;

  // 3. Top Header: Salon Logo or Salon Name pill
  if (logoImg) {
    const maxLogoH = isStory ? 112 : 92;
    const maxLogoW = 340;
    const ratio = logoImg.naturalWidth / Math.max(1, logoImg.naturalHeight);
    let drawW = maxLogoH * ratio;
    let drawH = maxLogoH;
    if (drawW > maxLogoW) {
      drawW = maxLogoW;
      drawH = drawW / ratio;
    }
    drawRoundedRect(ctx, padX - 18, topY - 14, drawW + 36, drawH + 28, 22);
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.fill();
    ctx.drawImage(logoImg, padX, topY, drawW, drawH);
  } else {
    ctx.font = "700 32px Inter, system-ui, -apple-system, sans-serif";
    const salonLabel = input.salonName.trim().toUpperCase().slice(0, 28) || "SEU SALÃO";
    const tw = ctx.measureText(salonLabel).width;
    drawRoundedRect(ctx, padX, topY, tw + 48, 64, 999);
    ctx.fillStyle = "rgba(15, 23, 42, 0.65)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(salonLabel, padX + 24, topY + 33);
  }

  // Optional Date validity pill at top-right
  if (input.dateRangeText.trim()) {
    const dateLabel = input.dateRangeText.trim().slice(0, 34);
    ctx.font = "600 26px Inter, system-ui, -apple-system, sans-serif";
    const dw = ctx.measureText(dateLabel).width;
    const pillW = dw + 46;
    const pillX = W - padX - pillW;
    drawRoundedRect(ctx, pillX, topY + 6, pillW, 54, 999);
    ctx.fillStyle = isFlash ? "#facc15" : "rgba(255, 255, 255, 0.94)";
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.textBaseline = "middle";
    ctx.fillText(dateLabel, pillX + 23, topY + 34);
  }

  // 4. Main Content Block (anchored cleanly at bottom)
  if (isMinimal) {
    const cardMargin = 56;
    const cardW = W - cardMargin * 2;
    const cardH = isStory ? 690 : input.format === "portrait" ? 560 : 480;
    const cardY = H - cardMargin - cardH;

    drawRoundedRect(ctx, cardMargin, cardY, cardW, cardH, 36);
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.shadowColor = "rgba(15, 23, 42, 0.26)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 16;
    ctx.fill();
    ctx.shadowColor = "transparent";

    let cursorY = cardY + 52;
    const innerX = cardMargin + 48;
    const innerW = cardW - 96;

    if (input.badgeText.trim()) {
      ctx.font = "700 24px Inter, system-ui, -apple-system, sans-serif";
      const bw = Math.min(innerW, ctx.measureText(input.badgeText.trim().toUpperCase()).width + 40);
      drawRoundedRect(ctx, innerX, cursorY, bw, 48, 999);
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      ctx.fillText(input.badgeText.trim().toUpperCase(), innerX + 20, cursorY + 25);
      cursorY += 72;
    }

    ctx.fillStyle = "#0f172a";
    ctx.font = `800 ${isStory ? 62 : 54}px Inter, system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = "top";
    const lines = wrapText(ctx, input.headline || "Oferta Especial", innerW, 3);
    const lineH = isStory ? 72 : 62;
    for (const line of lines) {
      ctx.fillText(line, innerX, cursorY);
      cursorY += lineH;
    }

    if (input.subline.trim()) {
      cursorY += 8;
      ctx.fillStyle = "#475569";
      ctx.font = "500 28px Inter, system-ui, -apple-system, sans-serif";
      const subLines = wrapText(ctx, input.subline, innerW, 2);
      for (const sl of subLines) {
        ctx.fillText(sl, innerX, cursorY);
        cursorY += 36;
      }
    }

    // Price row + CTA bar
    const footerY = cardY + cardH - 116;
    if (input.promoPriceText.trim()) {
      let priceX = innerX;
      if (input.priceText.trim()) {
        ctx.font = "600 32px Inter, system-ui, -apple-system, sans-serif";
        ctx.fillStyle = "#94a3b8";
        ctx.textBaseline = "alphabetic";
        const oldLabel = `De ${input.priceText}`;
        ctx.fillText(oldLabel, priceX, footerY + 12);
        const ow = ctx.measureText(oldLabel).width;
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(priceX, footerY + 2);
        ctx.lineTo(priceX + ow, footerY + 2);
        ctx.stroke();
        priceX += ow + 24;
      }
      ctx.font = "900 58px Inter, system-ui, -apple-system, sans-serif";
      ctx.fillStyle = accent;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(input.promoPriceText, priceX, footerY + 16);
    }

    if (input.ctaText.trim()) {
      ctx.font = "600 26px Inter, system-ui, -apple-system, sans-serif";
      ctx.fillStyle = "#334155";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(input.ctaText.trim(), innerX, cardY + cardH - 36);
    }
    return;
  }

  // Dark / Editorial / Flash / Glow layout
  const maxTextW = W - padX * 2;
  const bottomBase = H - (isStory ? 120 : 80);

  // Measure headline to stack cleanly upward from bottomBase
  const ctaH = input.ctaText.trim() ? 78 : 0;
  const priceH = input.promoPriceText.trim() ? 106 : 0;
  const subH = input.subline.trim() ? 52 : 0;

  ctx.font = `800 ${isStory ? 72 : 64}px Inter, system-ui, -apple-system, sans-serif`;
  const headlineLines = wrapText(ctx, input.headline || "Realce sua beleza", maxTextW, 3);
  const headlineLineH = isStory ? 84 : 74;
  const headlineH = headlineLines.length * headlineLineH;
  const badgeH = input.badgeText.trim() ? 66 : 0;

  let y = bottomBase - ctaH - priceH - subH - headlineH - badgeH - 28;

  // Badge
  if (input.badgeText.trim()) {
    const label = input.badgeText.trim().toUpperCase();
    ctx.font = "800 25px Inter, system-ui, -apple-system, sans-serif";
    const bw = Math.min(maxTextW, ctx.measureText(label).width + 44);
    drawRoundedRect(ctx, padX, y, bw, 50, 999);
    ctx.fillStyle = isFlash ? "#facc15" : accent;
    ctx.fill();
    ctx.fillStyle = isFlash ? "#09090b" : "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, padX + 22, y + 26);
    y += badgeH;
  }

  // Headline
  ctx.fillStyle = "#ffffff";
  ctx.font = `800 ${isStory ? 72 : 64}px Inter, system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = "top";
  for (const line of headlineLines) {
    ctx.fillText(line, padX, y);
    y += headlineLineH;
  }

  // Subline
  if (input.subline.trim()) {
    y += 10;
    ctx.fillStyle = "rgba(241, 245, 249, 0.88)";
    ctx.font = "500 30px Inter, system-ui, -apple-system, sans-serif";
    const sl = wrapText(ctx, input.subline, maxTextW, 1)[0] ?? "";
    ctx.fillText(sl, padX, y);
    y += subH;
  }

  // Price Block
  if (input.promoPriceText.trim()) {
    y += 16;
    const priceBoxH = 90;
    const hasOld = Boolean(input.priceText.trim());
    ctx.font = "900 58px Inter, system-ui, -apple-system, sans-serif";
    const newW = ctx.measureText(input.promoPriceText).width;
    ctx.font = "600 30px Inter, system-ui, -apple-system, sans-serif";
    const oldLabel = hasOld ? `De ${input.priceText}` : "";
    const oldW = hasOld ? ctx.measureText(oldLabel).width + 26 : 0;

    const boxW = Math.min(maxTextW, oldW + newW + 68);
    drawRoundedRect(ctx, padX, y, boxW, priceBoxH, 24);
    ctx.fillStyle = isFlash ? "#facc15" : "rgba(255, 255, 255, 0.14)";
    ctx.fill();
    if (!isFlash) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.30)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    let px = padX + 32;
    if (hasOld) {
      ctx.font = "600 30px Inter, system-ui, -apple-system, sans-serif";
      ctx.fillStyle = isFlash ? "rgba(9, 9, 11, 0.65)" : "rgba(226, 232, 240, 0.78)";
      ctx.textBaseline = "middle";
      ctx.fillText(oldLabel, px, y + priceBoxH / 2 + 2);
      const ow = ctx.measureText(oldLabel).width;
      ctx.strokeStyle = isFlash ? "rgba(9, 9, 11, 0.65)" : "rgba(226, 232, 240, 0.85)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(px, y + priceBoxH / 2 + 2);
      ctx.lineTo(px + ow, y + priceBoxH / 2 + 2);
      ctx.stroke();
      px += ow + 24;
    }

    ctx.font = "900 58px Inter, system-ui, -apple-system, sans-serif";
    ctx.fillStyle = isFlash ? "#09090b" : "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(input.promoPriceText, px, y + priceBoxH / 2 + 2);
    y += priceBoxH + 18;
  }

  // CTA Bar
  if (input.ctaText.trim()) {
    const ctaText = input.ctaText.trim();
    ctx.font = "700 28px Inter, system-ui, -apple-system, sans-serif";
    const cw = Math.min(maxTextW, ctx.measureText(ctaText).width + 64);
    drawRoundedRect(ctx, padX, y, cw, 64, 18);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.fillStyle = "#0f172a";
    ctx.textBaseline = "middle";
    ctx.fillText(ctaText, padX + 32, y + 33);
  }
}

export async function renderMarketingArtworkToJpegDataUrl(
  input: StudioCanvasInput,
  quality = 0.92,
): Promise<string> {
  const canvas = document.createElement("canvas");
  await renderMarketingArtworkToCanvas(canvas, input);
  return canvas.toDataURL("image/jpeg", quality);
}
