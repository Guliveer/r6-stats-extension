// Compose the bundled `champion-small.webp` (which has a black rectangle baked in for
// exactly this purpose) with a leaderboard rank number drawn into it. Result is exposed
// as a data URL the swap loop can drop straight into <img src> / <image href>.
//
// We use champion-small as the base regardless of iconSet preference — it's the only
// Champion artwork we ship that has the central plate the number can sit on. Mixing in
// `v7-champion-i` (no plate) or `champion-star` (vertical chevrons) would force us to
// also draw the plate, which adds visual chrome the user didn't ask for.

const ICON_PATH = 'icons/ranks/champion-small.webp';

const BASE_SIZE = 240;

const cache = new Map<number, string>();

let baseImagePromise: Promise<HTMLImageElement> | null = null;

function loadBaseImage(): Promise<HTMLImageElement> {
  if (baseImagePromise) return baseImagePromise;
  baseImagePromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = chrome.runtime.getURL(ICON_PATH);
  });
  return baseImagePromise;
}

// Plate-painting heuristic: at 240px source the native plate is 130×62. We over-paint
// it to 165×80 so there's room for a larger font (the icon renders at ~40 px in
// the popup; bigger source font survives downscaling much better). The expanded plate
// stays inside the shield's outer frame.
const PAINTED_PLATE = { x: 38, y: 100, w: 165, h: 80 } as const;
const PAINTED_PLATE_CENTER_X = PAINTED_PLATE.x + PAINTED_PLATE.w / 2;
const PAINTED_PLATE_CENTER_Y = PAINTED_PLATE.y + PAINTED_PLATE.h / 2;

const FONT_FAMILY = '"Arial Narrow", "Helvetica Neue", "Segoe UI", system-ui, sans-serif';

// Pick the largest font size that fits the painted plate, with a wide range so 1-3
// digit numbers fill the plate vertically and 4-digit numbers shrink gracefully.
function fitFontPx(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, startPx: number): number {
  let px = startPx;
  while (px > 36) {
    ctx.font = `900 ${px}px ${FONT_FAMILY}`;
    if (ctx.measureText(text).width <= maxWidth) return px;
    px -= 2;
  }
  return px;
}

export async function composeChampionWithRank(rank: number): Promise<string | null> {
  const cached = cache.get(rank);
  if (cached) return cached;

  try {
    const base = await loadBaseImage();
    const canvas = document.createElement('canvas');
    canvas.width = BASE_SIZE;
    canvas.height = BASE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(base, 0, 0, BASE_SIZE, BASE_SIZE);

    // Over-paint a larger black plate on top of the native one so we can use a bigger
    // font (the source plate is sized for tracker.gg's pixel density, not ours).
    ctx.fillStyle = '#000000';
    ctx.fillRect(PAINTED_PLATE.x, PAINTED_PLATE.y, PAINTED_PLATE.w, PAINTED_PLATE.h);

    const text = String(rank);
    const fontPx = fitFontPx(ctx, text, PAINTED_PLATE.w - 18, 76);

    // Drop shadow doubles as a halo when the icon ends up downscaled — the
    // soft black behind white preserves the digit shape under bilinear sampling.
    ctx.font = `900 ${fontPx}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, PAINTED_PLATE_CENTER_X, PAINTED_PLATE_CENTER_Y);
    // Reset shadow before adding the crisp outline so the stroke isn't blurred.
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, PAINTED_PLATE_CENTER_X, PAINTED_PLATE_CENTER_Y);

    const dataUrl = canvas.toDataURL('image/webp');
    cache.set(rank, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}
