import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, '..', 'public', 'icons');
const LOGO_PATH = join(ICONS_DIR, 'r6-logo-new.svg');

// Strip the outer <svg ...> wrapper from the logo so we can re-embed its <path> at our
// preferred viewBox/scale. The logo authoring viewBox is 0 0 50 50.
const logoSrc = readFileSync(LOGO_PATH, 'utf8');
const innerMatch = logoSrc.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
if (!innerMatch) throw new Error('Could not parse logo SVG');
const logoInner = innerMatch[1];

const sizes = [16, 48, 128];

// Pad the logo inside a brand-colored rounded square. The 50x50 logo is centered with
// ~14% margin so it doesn't feel cramped against the rounded corners.
const composeSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="22" fill="#ea580c"/>
  <g transform="translate(18 18) scale(1.84)">${logoInner}</g>
</svg>`;

const composedSvg = composeSvg();
writeFileSync(join(ICONS_DIR, 'icon128.svg'), composedSvg);
writeFileSync(join(ICONS_DIR, 'icon48.svg'), composedSvg);
writeFileSync(join(ICONS_DIR, 'icon16.svg'), composedSvg);

const svgBuffer = Buffer.from(composedSvg);
await Promise.all(
  sizes.map((s) =>
    sharp(svgBuffer).resize(s, s).png().toFile(join(ICONS_DIR, `icon${s}.png`))
  )
);

console.log(`Generated icons (${sizes.join(', ')}px) into public/icons/`);
