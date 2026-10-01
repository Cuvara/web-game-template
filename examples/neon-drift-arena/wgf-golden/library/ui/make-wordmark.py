"""Draw the title wordmark: "NEON DRIFT / ARENA" set in Unbounded 800, outlined to paths.

The glyphs are the bundled face's own outlines (../fonts/unbounded-800.woff2, OFL-1.1), so
the SVG renders the display face as an <img> with no font loading. Needs fontTools (and
brotli to read WOFF2):  python3 make-wordmark.py  ->  wordmark.svg beside this file.
"""

import os

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, "..", "fonts", "unbounded-800.woff2")


def line(font, text, size, x, baseline, tracking=0.0):
    """(path data, advance) of `text` at `size` px, its baseline at y=`baseline`."""
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = size / font["head"].unitsPerEm
    pen = SVGPathPen(glyphs)
    cursor = x
    for char in text:
        name = cmap[ord(char)]
        glyph = glyphs[name]
        glyph.draw(TransformPen(pen, (scale, 0, 0, -scale, cursor, baseline)))
        cursor += glyph.width * scale + tracking * size
    return pen.getCommands(), cursor - x - tracking * size


def main():
    font = TTFont(FONT)
    width = 640
    top, top_w = line(font, "NEON DRIFT", 80, 0, 0, 0.02)
    sub, sub_w = line(font, "ARENA", 44, 0, 0, 0.45)
    tx = (width - top_w) / 2
    sx = (width - sub_w) / 2
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} 220" width="{width}" height="220">
  <title>Neon Drift Arena</title>
  <path transform="translate({tx:.2f} 104)" fill="none" stroke="#FF2E88" stroke-width="6" stroke-linejoin="round" d="{top}"/>
  <path transform="translate({tx:.2f} 104)" fill="#EDEBFF" d="{top}"/>
  <rect x="40" y="128" width="{width - 80}" height="4" fill="#FF2E88"/>
  <rect x="96" y="138" width="{width - 192}" height="2" fill="#2EF2FF"/>
  <path transform="translate({sx:.2f} 196)" fill="#2EF2FF" d="{sub}"/>
</svg>
"""
    with open(os.path.join(HERE, "wordmark.svg"), "w", encoding="utf-8") as out:
        out.write(svg)


if __name__ == "__main__":
    main()
