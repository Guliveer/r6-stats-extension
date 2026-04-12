import sharp from 'sharp';

const sizes = [16, 48, 128];
const svg = (s) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 128 128"><rect width="128" height="128" rx="20" fill="#ea580c"/><text x="64" y="82" font-family="Arial,Helvetica,sans-serif" font-size="52" font-weight="bold" fill="white" text-anchor="middle">R6</text></svg>`);

await Promise.all(
  sizes.map((s) => sharp(svg(s)).resize(s, s).png().toFile(`dist/icons/icon${s}.png`))
);
console.log('PNG icons generated');
