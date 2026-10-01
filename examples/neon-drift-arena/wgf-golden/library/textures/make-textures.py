"""Draw the arena's two textures as PNG, with the standard library only.

  sky.png    16 x 512, the night gradient behind the skyline (the `sky` requirement)
  spark.png  64 x 64 RGBA, the crash burst's particle: a hot core and a four-point flare
             (the `crash-vfx` requirement)

    python3 make-textures.py   ->  both files beside this script
"""

import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))


def png(path, width, height, rows, alpha):
    """Write 8-bit RGB(A) rows (lists of tuples) as a PNG."""
    raw = b"".join(b"\x00" + bytes(c for px in row for c in px) for row in rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    header = struct.pack(">IIBBBBB", width, height, 8, 6 if alpha else 2, 0, 0, 0)
    with open(path, "wb") as out:
        out.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
                  + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def hex_rgb(value):
    return tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))


# Top to bottom: deep night, the identity's surface, a magenta haze at the horizon, ground.
SKY = [(0.0, "#05050C"), (0.42, "#16162A"), (0.6, "#3A1450"), (0.66, "#1A1030"),
       (1.0, "#0B0B12")]


def sky_at(t):
    for (t0, c0), (t1, c1) in zip(SKY, SKY[1:]):
        if t <= t1:
            k = (t - t0) / (t1 - t0) if t1 > t0 else 0
            a, b = hex_rgb(c0), hex_rgb(c1)
            return tuple(round(a[i] + (b[i] - a[i]) * k) for i in range(3))
    return hex_rgb(SKY[-1][1])


def main():
    width, height = 16, 512
    png(os.path.join(HERE, "sky.png"), width, height,
        [[sky_at(y / (height - 1))] * width for y in range(height)], alpha=False)

    size, core, hot = 64, hex_rgb("#FFF4D6"), hex_rgb("#FFB020")
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            dx, dy = (x + 0.5 - size / 2) / (size / 2), (y + 0.5 - size / 2) / (size / 2)
            r = math.hypot(dx, dy)
            glow = max(0.0, 1 - r) ** 2
            flare = max(0.0, 1 - abs(dx) * 9) * max(0.0, 1 - abs(dy)) \
                + max(0.0, 1 - abs(dy) * 9) * max(0.0, 1 - abs(dx))
            a = min(1.0, glow + 0.8 * flare)
            mix = min(1.0, max(0.0, 1 - r * 2.5))
            colour = tuple(round(hot[i] + (core[i] - hot[i]) * mix) for i in range(3))
            row.append(colour + (round(255 * a),))
        rows.append(row)
    png(os.path.join(HERE, "spark.png"), size, size, rows, alpha=True)


if __name__ == "__main__":
    main()
