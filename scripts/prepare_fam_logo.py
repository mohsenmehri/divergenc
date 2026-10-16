"""Prepare the supplied fam-1 logo without redrawing or recolouring its ink.
Requires Pillow. Produces a transparent, tightly cropped PNG for the glass frame.
Run: python scripts/prepare_fam_logo.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
source = Image.open(ROOT / 'fam-1.png').convert('RGBA')
result = Image.new('RGBA', source.size)
mask = Image.new('L', source.size)
for y in range(source.height):
    for x in range(source.width):
        r, g, b, original_alpha = source.getpixel((x, y))
        chroma = max(r, g, b) - min(r, g, b)
        # Remove neutral white/grey paper (including its diagonal grey pattern).
        coverage = min(1.0, max(0.0, (chroma - 12) / 88))
        if coverage == 0:
            continue
        # Keep saturated blue/green pixels byte-for-byte. Remove the white matte
        # from partially covered edge pixels so they do not acquire white halos.
        rgb = tuple(max(0, min(255, round((v - 255 * (1 - coverage)) / coverage))) for v in (r, g, b))
        result.putpixel((x, y), (*rgb, round(original_alpha * coverage)))
        if chroma >= 60 and original_alpha:
            mask.putpixel((x, y), 255)
bounds = mask.getbbox()
assert bounds, 'No coloured logo pixels found'
pad = 3
box = (max(0, bounds[0]-pad), max(0, bounds[1]-pad), min(source.width, bounds[2]+pad), min(source.height, bounds[3]+pad))
result = result.crop(box)
out = ROOT / 'assets/fam-1-glass.png'
out.parent.mkdir(parents=True, exist_ok=True)
result.save(out, optimize=True)
assert result.getchannel('A').getextrema() == (0, 255)
print(f'{source.size} -> {result.size}, crop={box}; saved {out.relative_to(ROOT)}')
