#!/usr/bin/env python3
"""Tower Merge Rush production art: the source of every file in this library.

GOLDEN-RUN FIXTURE. Authored by hand for web-game-template's 2D golden port and released
under CC0-1.0 (see ../library.json). Deterministic: the same script writes the same bytes.

The look is the design's `riso-arcade` identity kit: risograph print on warm paper, two
misregistered inks (pink and blue, purple where they overlap), thick ink outlines, halftone
shading. Every colour below is a palette token or within the asset-quality tolerance of one
(the yellow lamp light is the one deliberate third ink, kept under the off-palette share).

    python3 tools/make_art.py            # rewrite svg/ and fonts/ (fonts need fontTools)

The font files are subset (Latin-1 + Cyrillic + punctuation) WOFF2 builds of OFL-1.1 Google
Fonts families: the faces the design's riso-arcade typography names for a title whose
scope.locales include ru - Rubik Mono One for Bungee (display), Manrope for Figtree (body),
the kit's covering alternates (scripts/wgf_design/identity.py ALTERNATES in the Factory).
Their sources are github.com/google/fonts ofl/rubikmonoone and ofl/manrope, read from
WGF_FONT_SOURCE_DIR; their OFL texts are kept beside them. The wordmark's letters are
Bungee's own outlines (Latin only: the title is a name), converted to paths so the SVG needs
no font at load time.
"""

import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# riso-arcade palette (scripts/wgf_design/identity.py in the Factory)
PAPER = "#F4EDE1"
INK = "#1C1A17"
PINK = "#FF48B0"
BLUE = "#0078BF"
PURPLE = "#6C3C9E"
RED = "#E3350D"
# Tints within the palette tolerance (RGB distance 60) of a token.
PAPER_SHADE = "#E4D9C6"
PINK_LIGHT = "#FF7AC6"
BLUE_LIGHT = "#2E92D2"
# The third ink: lamp light and windows only.
SUN = "#FFD23F"

# The bundled faces, display first: the game binds the first file to its display face and the
# second to its body face.
FONT_SOURCES = {
    "RubikMonoOne": ("rubikmonoone_RubikMonoOne-Regular.ttf", "rubikmonoone_OFL.txt"),
    "Manrope": ("manrope_Manrope[wght].ttf", "manrope_OFL.txt"),
}
WORDMARK_FONT = "bungee_Bungee-Regular.ttf"
FONT_DIR = os.environ.get("WGF_FONT_SOURCE_DIR", "/tmp/wgf-dui/fonts")


def svg(width, height, body, defs="", view=None, extra=""):
    view = view or f"0 0 {width} {height}"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="{view}"{extra}>\n<defs>{defs}</defs>\n{body}\n</svg>\n')


def halftone(pid, color, step=6, r=1.4):
    return (f'<pattern id="{pid}" width="{step}" height="{step}" patternUnits="userSpaceOnUse">'
            f'<circle cx="{step / 2}" cy="{step / 2}" r="{r}" fill="{color}"/></pattern>')


def path(d, fill, sw=5, extra=""):
    stroke = f' stroke="{INK}" stroke-width="{sw}" stroke-linejoin="round" stroke-linecap="round"' \
        if sw else ""
    return f'<path d="{d}" fill="{fill}"{stroke}{extra}/>'


def misreg(d, color, dx=4, dy=3):
    """The second ink, printed a little off: the risograph's signature."""
    return f'<path d="{d}" fill="{color}" transform="translate({dx} {dy})" opacity="0.9"/>'


def shade(d, pid="dots"):
    """Halftone shading over a shape (the shadow side)."""
    return f'<path d="{d}" fill="url(#{pid})" opacity="0.55"/>'


def rect_d(x, y, w, h):
    return f"M{x} {y}h{w}v{h}h{-w}Z"


def line(x1, y1, x2, y2, sw=4, color=INK):
    return (f'<path d="M{x1} {y1}L{x2} {y2}" fill="none" stroke="{color}" stroke-width="{sw}" '
            f'stroke-linecap="round"/>')


def circle(cx, cy, r, fill, sw=4):
    stroke = f' stroke="{INK}" stroke-width="{sw}"' if sw else ""
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}"{stroke}/>'


def ground(cx=96, w=70):
    """The halftone ground shadow every piece stands on."""
    return (f'<ellipse cx="{cx}" cy="184" rx="{w}" ry="6" fill="url(#dots)"/>'
            f'<path d="M{cx - w + 8} 184H{cx + w - 8}" stroke="{INK}" stroke-width="4" '
            f'stroke-linecap="round"/>')


PIECE_DEFS = halftone("dots", INK) + halftone("pinkdots", PINK, 5, 1.5)


def piece(level, body):
    return svg(96, 96, body, PIECE_DEFS, view="0 0 192 192",
               extra=f' data-level="{level}" data-wgf-off-palette="lamp and window light are '
                     f'the riso third ink (sunflower)"')


# --- the ten towers -------------------------------------------------------------------------
# One silhouette per level, each taller than the last: a player reads the level from the
# shape and size before the numeral badge the game draws on it.


def piece_1():  # Shed: a squat pink block with a slab roof and a door
    body = rect_d(58, 132, 76, 52)
    roof = "M48 122h96l-6 14H54Z"
    return piece(1, "".join([
        ground(96, 56),
        misreg(body, BLUE), path(body, PINK), shade("M110 132h24v52h-24Z"),
        misreg(roof, PURPLE), path(roof, BLUE),
        path("M84 184v-30a12 12 0 0 1 24 0v30Z", PAPER, 4),
        circle(70, 150, 6, SUN, 3), circle(122, 150, 6, SUN, 3),
    ]))


def piece_2():  # Cottage: blue walls, a pink gable roof, a chimney
    walls = rect_d(54, 126, 84, 58)
    roof = "M40 130L96 88L152 130Z"
    chimney = rect_d(116, 92, 14, 26)
    return piece(2, "".join([
        ground(96, 62),
        path(chimney, RED, 4),
        misreg(walls, PINK), path(walls, BLUE), shade("M112 126h26v58h-26Z"),
        misreg(roof, PURPLE), path(roof, PINK), shade("M96 88L152 130H96Z", "dots"),
        path("M86 184v-26h20v26Z", PAPER, 4),
        path(rect_d(62, 140, 16, 16), SUN, 3), line(70, 140, 70, 156, 2.5), line(62, 148, 78, 148, 2.5),
        path(rect_d(114, 140, 16, 16), SUN, 3), line(122, 140, 122, 156, 2.5), line(114, 148, 130, 148, 2.5),
        circle(96, 112, 7, PAPER, 3),
    ]))


def piece_3():  # Watchtower: tapered purple stone, crenellations, a pennant
    tower = "M62 184L70 92H122L130 184Z"
    battlement = "M62 96V72h14v10h12V72h16v10h12V72h14v24Z"
    flag = "M96 72V36M96 38l28 8l-28 9Z"
    return piece(3, "".join([
        ground(96, 58),
        misreg(tower, PINK), path(tower, PURPLE), shade("M104 92h18l8 92h-26Z"),
        misreg(battlement, BLUE), path(battlement, PURPLE),
        line(96, 72, 96, 36, 4), path("M96 38l30 8l-30 10Z", PINK, 4),
        line(72, 120, 120, 120, 3), line(70, 150, 124, 150, 3),
        line(88, 92, 88, 120, 3), line(106, 120, 106, 150, 3), line(84, 150, 84, 184, 3),
        path("M92 136v-14a4 4 0 0 1 8 0v14Z", SUN, 3),
        path("M88 184v-20a8 8 0 0 1 16 0v20Z", PAPER, 4),
    ]))


def piece_4():  # Water tower: a red tank on braced legs under a blue cone
    tank = "M56 80h80v44a8 8 0 0 1-8 8H64a8 8 0 0 1-8-8Z"
    cap = "M50 82L96 50L142 82Z"
    legs = "".join([line(66, 132, 58, 184, 6), line(126, 132, 134, 184, 6),
                    line(84, 132, 82, 184, 5), line(108, 132, 110, 184, 5),
                    line(62, 152, 130, 168, 3.5), line(130, 152, 62, 168, 3.5)])
    return piece(4, "".join([
        ground(96, 60), legs,
        misreg(tank, PINK), path(tank, RED), shade("M112 80h24v44a8 8 0 0 1-8 8h-16Z"),
        line(56, 96, 136, 96, 3), line(56, 114, 136, 114, 3),
        misreg(cap, PURPLE), path(cap, BLUE),
        circle(96, 50, 5, PINK, 3),
        path("M70 98h20v14H70Z", PAPER, 3),
        line(124, 132, 124, 184, 3), line(119, 144, 129, 144, 2.5), line(119, 158, 129, 158, 2.5),
        line(119, 172, 129, 172, 2.5),
    ]))


def piece_5():  # Lighthouse: striped tapering tower, a glowing lantern room
    body = "M70 184L80 78H112L122 184Z"
    stripes = "M72 160H120L121 172H71ZM75 124H117L118 136H74ZM78 92H114L115 102H77Z"
    return piece(5, "".join([
        ground(96, 56),
        '<path d="M60 44L24 30M60 54L22 62M132 44L168 30M132 54L170 62" stroke="' + PINK
        + '" stroke-width="5" stroke-linecap="round" fill="none"/>',
        misreg(body, BLUE), path(body, PAPER),
        f'<path d="{stripes}" fill="{PINK}"/>', path(body, "none"),
        shade("M100 78h12l10 106h-22Z"),
        path(rect_d(72, 70, 48, 10), INK, 0),
        path(rect_d(80, 40, 32, 30), SUN, 4),
        line(96, 40, 96, 70, 3),
        misreg("M76 42a20 18 0 0 1 40 0Z", PURPLE, 3, 2), path("M76 42a20 18 0 0 1 40 0Z", BLUE, 4),
        line(96, 24, 96, 14, 4),
        path("M88 184v-22a8 8 0 0 1 16 0v22Z", BLUE, 4),
    ]))


def piece_6():  # Clock tower: blue shaft, paper clock face, purple belfry, pink spire
    base = rect_d(60, 164, 72, 20)
    shaft = rect_d(70, 82, 52, 84)
    belfry = rect_d(72, 52, 48, 32)
    spire = "M68 54L96 10L124 54Z"
    return piece(6, "".join([
        ground(96, 58),
        misreg(base, PINK), path(base, PURPLE),
        misreg(shaft, PINK), path(shaft, BLUE), shade("M104 82h18v84h-18Z"),
        misreg(belfry, BLUE), path(belfry, PURPLE),
        path("M86 84V68a10 10 0 0 1 20 0v16Z", SUN, 3),
        misreg(spire, BLUE), path(spire, PINK),
        circle(96, 112, 19, PAPER, 4),
        line(96, 112, 96, 99, 3.5), line(96, 112, 105, 117, 3.5), circle(96, 112, 2.5, INK, 0),
        line(96, 95, 96, 96, 3), line(113, 112, 112, 112, 3), line(79, 112, 80, 112, 3),
        path("M88 164v-18a8 8 0 0 1 16 0v18Z", PAPER, 4),
    ]))


def piece_7():  # Skyscraper: purple setbacks, a window grid, an antenna
    base = rect_d(60, 96, 72, 88)
    mid = rect_d(70, 58, 52, 40)
    top = rect_d(80, 32, 32, 28)
    windows = []
    for row in range(5):
        for col in range(4):
            lit = (row * 3 + col * 5) % 4 == 0
            windows.append(path(rect_d(68 + col * 16, 106 + row * 14, 8, 8),
                                SUN if lit else BLUE_LIGHT, 0))
    for row in range(2):
        for col in range(3):
            windows.append(path(rect_d(78 + col * 14, 66 + row * 14, 8, 8),
                                SUN if (row + col) % 2 else BLUE_LIGHT, 0))
    return piece(7, "".join([
        ground(96, 58),
        misreg(base, PINK), path(base, PURPLE),
        misreg(mid, BLUE), path(mid, PURPLE),
        misreg(top, PINK), path(top, BLUE),
        "".join(windows),
        shade("M112 96h20v88h-20Z"),
        line(96, 32, 96, 8, 4), circle(96, 8, 5, PINK, 3),
        line(86, 46, 106, 46, 3),
        path("M84 184v-16h24v16Z", PINK, 4),
    ]))


def piece_8():  # Crown spire: a three-tier pagoda under a star, haloed
    rays = "".join(
        f'<path d="M96 40L{96 + 88 * c:.1f} {40 + 88 * s:.1f}" stroke="{PINK_LIGHT}" '
        f'stroke-width="6" stroke-linecap="round"/>'
        for c, s in [(1, 0), (-1, 0), (0.7, -0.7), (-0.7, -0.7), (0.92, 0.38), (-0.92, 0.38),
                     (0.38, -0.92), (-0.38, -0.92)])
    tiers = [
        ("M44 150L148 150L136 136L56 136Z", rect_d(58, 150, 76, 34), PINK),
        ("M52 112L140 112L128 98L64 98Z", rect_d(66, 112, 60, 26), BLUE),
        ("M60 76L132 76L120 62L72 62Z", rect_d(74, 76, 44, 24), PURPLE),
    ]
    out = [ground(96, 66), rays, circle(96, 40, 30, "url(#pinkdots)", 0)]
    for roof, wall, color in tiers:
        out += [misreg(wall, PINK if color != PINK else BLUE), path(wall, color),
                misreg(roof, PURPLE), path(roof, RED)]
    star = "M96 14L102 30L119 30L105 40L110 56L96 46L82 56L87 40L73 30L90 30Z"
    out += [
        shade("M112 150h22v34h-22Z"), shade("M108 112h18v26h-18Z"),
        path("M86 184v-20a10 10 0 0 1 20 0v20Z", SUN, 4),
        circle(96, 124, 6, SUN, 3), circle(96, 88, 5, SUN, 3),
        misreg(star, BLUE, 3, 3), path(star, SUN, 4),
    ]
    return piece(8, "".join(out))


def piece_9():  # Sky needle: a TV tower - flared tripod, a slim shaft, an orb deck, a mast
    legs = "M44 184L86 120H106L148 184H124L100 140H92L68 184Z"
    shaft = rect_d(86, 74, 20, 50)
    orb = "M60 66a36 30 0 1 0 72 0a36 30 0 1 0-72 0Z"
    deck = "M54 66H138"
    windows = "".join(path(rect_d(68 + i * 14, 58, 8, 12), SUN, 2.5) for i in range(5))
    return piece(9, "".join([
        ground(96, 66),
        misreg(legs, PINK), path(legs, BLUE), shade("M106 120l42 64h-24l-22-40Z"),
        misreg(shaft, BLUE), path(shaft, PURPLE), line(86, 92, 106, 92, 3), line(86, 108, 106, 108, 3),
        misreg(orb, BLUE), path(orb, PINK), shade("M96 36a36 30 0 0 1 0 60Z", "dots"),
        windows,
        line(54, 66, 138, 66, 4),
        line(96, 36, 96, 4, 5), circle(96, 6, 5, RED, 3), line(88, 20, 104, 20, 3),
    ]))


def piece_10():  # Sky citadel: a walled keep between twin turrets, its spire under a crown
    wall = rect_d(38, 128, 116, 56)
    keep = rect_d(68, 74, 56, 56)
    left, right = rect_d(34, 70, 30, 114), rect_d(128, 70, 30, 114)
    roof_l, roof_r = "M28 72L49 28L70 72Z", "M122 72L143 28L164 72Z"
    spire = "M64 76L96 18L128 76Z"
    crown = "M76 20L76 2L86 12L96 0L106 12L116 2L116 20Z"
    return piece(10, "".join([
        ground(96, 66),
        misreg(wall, PINK), path(wall, BLUE), shade("M128 128h26v56h-26Z"),
        misreg(left, BLUE), path(left, PURPLE), misreg(right, BLUE), path(right, PURPLE),
        misreg(roof_l, PURPLE), path(roof_l, PINK), misreg(roof_r, PURPLE), path(roof_r, PINK),
        misreg(keep, PINK), path(keep, PURPLE), shade("M106 74h18v56h-18Z"),
        misreg(spire, BLUE), path(spire, RED),
        path(crown, SUN, 4),
        path(rect_d(43, 92, 12, 18), SUN, 3), path(rect_d(137, 92, 12, 18), SUN, 3),
        circle(96, 100, 9, SUN, 3),
        path("M80 184v-30a16 16 0 0 1 32 0v30Z", PAPER, 4),
        line(96, 138, 96, 184, 3),
    ]))


PIECES = [piece_1, piece_2, piece_3, piece_4, piece_5, piece_6, piece_7, piece_8, piece_9,
          piece_10]


# --- board, backdrop, effects, UI -----------------------------------------------------------


def track_frame():
    """The track's 9-slice frame: 40 px borders, a flat centre that stretches cleanly."""
    s = 144
    defs = halftone("dots", INK, 5, 1.3)
    return svg(s, s, "".join([
        path("M10 10h128v128H10Z", INK, 0),                      # hard offset shadow
        path("M4 4h128v128H4Z", PAPER, 6),
        path("M18 18h100v100H18Z", PAPER_SHADE, 4),               # the track bed
        f'<path d="M4 4h36v36H4ZM104 4h28v36h-28ZM4 104h36v28H4ZM104 104h28v28h-28Z" '
        f'fill="url(#dots)" opacity="0.35"/>',
        line(12, 11, 124, 11, 3, PINK), line(12, 125, 124, 125, 3, BLUE),
        line(11, 12, 11, 124, 3, PINK), line(125, 12, 125, 124, 3, BLUE),
        circle(11, 11, 4, BLUE, 2.5), circle(125, 11, 4, BLUE, 2.5),
        circle(11, 125, 4, PINK, 2.5), circle(125, 125, 4, PINK, 2.5),
    ]), defs, extra=' data-slice="40"')


def backdrop():
    """The sky over a riso-printed city: quiet, lower contrast than the track."""
    w, h = 1920, 1080
    rnd = random.Random(1408)
    defs = (halftone("grain", INK, 7, 0.9) + halftone("sundots", PINK, 14, 4.6)
            + halftone("bluedots", BLUE, 10, 2.6))

    def skyline(base, lo, hi, minw, maxw, seed):
        r = random.Random(seed)
        x, d = -20, [f"M-20 {h}"]
        while x < w + 20:
            bw = r.randint(minw, maxw)
            top = base - r.randint(lo, hi)
            d.append(f"L{x} {top}")
            if r.random() < 0.3:  # a spire or a stepped roof
                d.append(f"L{x + bw // 2 - 8} {top}L{x + bw // 2} {top - r.randint(30, 70)}"
                         f"L{x + bw // 2 + 8} {top}")
            d.append(f"L{x + bw} {top}")
            x += bw
        d.append(f"L{w + 20} {h}Z")
        return "".join(d)

    far = skyline(820, 60, 260, 70, 150, 3)
    near = skyline(930, 40, 200, 90, 180, 11)
    clouds = []
    for cx, cy, s in [(260, 220, 1.0), (760, 140, 0.7), (1640, 210, 0.85), (1120, 300, 0.6)]:
        d = (f"M{cx - 120 * s} {cy}a{60 * s} {50 * s} 0 0 1 {90 * s} {-40 * s}"
             f"a{70 * s} {60 * s} 0 0 1 {120 * s} {-10 * s}a{50 * s} {44 * s} 0 0 1 "
             f"{70 * s} {50 * s}Z")
        clouds.append(f'<path d="{d}" fill="{PAPER}" stroke="{BLUE}" stroke-width="5" '
                      f'opacity="0.8"/>')
    windows = []
    for _ in range(90):
        x = rnd.randint(0, w)
        y = rnd.randint(860, 1040)
        windows.append(f'<rect x="{x}" y="{y}" width="10" height="14" fill="{SUN}" '
                       f'opacity="0.4"/>')
    body = "".join([
        f'<rect width="{w}" height="{h}" fill="{PAPER}"/>',
        f'<rect width="{w}" height="{h}" fill="url(#grain)" opacity="0.10"/>',
        f'<circle cx="1390" cy="360" r="240" fill="url(#sundots)" opacity="0.75"/>',
        f'<circle cx="1402" cy="368" r="240" fill="none" stroke="{BLUE}" stroke-width="6" '
        f'opacity="0.45"/>',
        "".join(clouds),
        f'<path d="{far}" fill="url(#bluedots)" opacity="0.4"/>',
        f'<path d="{far}" fill="none" stroke="{BLUE}" stroke-width="4" opacity="0.5"/>',
        f'<path d="{near}" fill="{PINK}" opacity="0.22" transform="translate(9 6)"/>',
        f'<path d="{near}" fill="{PURPLE}" opacity="0.32"/>',
        "".join(windows),
        f'<rect y="1010" width="{w}" height="70" fill="{PAPER_SHADE}"/>',
        f'<path d="M0 1010H{w}" stroke="{INK}" stroke-width="5" opacity="0.6"/>',
    ])
    return svg(w, h, body, defs, extra=' preserveAspectRatio="xMidYMax slice" '
               'data-wgf-off-palette="lit windows are the riso third ink (sunflower)"')


def merge_burst():
    pts = []
    import math
    for i in range(24):
        r = 76 if i % 2 == 0 else 38
        a = math.pi * 2 * i / 24 - math.pi / 2
        pts.append(f"{80 + r * math.cos(a):.1f} {80 + r * math.sin(a):.1f}")
    star = "M" + "L".join(pts) + "Z"
    inner = []
    for i in range(16):
        r = 40 if i % 2 == 0 else 20
        a = math.pi * 2 * i / 16
        inner.append(f"{80 + r * math.cos(a):.1f} {80 + r * math.sin(a):.1f}")
    core = "M" + "L".join(inner) + "Z"
    return svg(160, 160, "".join([
        misreg(star, BLUE, 4, 4), path(star, PINK, 4),
        path(core, SUN, 3),
        circle(80, 80, 9, PAPER, 3),
        circle(18, 22, 5, BLUE, 0), circle(140, 30, 4, PURPLE, 0), circle(146, 130, 5, BLUE, 0),
        circle(20, 136, 4, PURPLE, 0),
    ]), extra=' data-wgf-off-palette="the burst core is the riso third ink (sunflower)"')


def merge_streak():
    return svg(256, 64, "".join([
        path("M8 32C60 14 160 10 248 24L248 40C160 54 60 50 8 32Z", PINK, 4),
        f'<path d="M30 32C80 24 160 22 236 28" stroke="{PAPER}" stroke-width="6" '
        f'stroke-linecap="round" fill="none"/>',
        f'<path d="M60 14L200 8M80 54L220 56" stroke="{BLUE}" stroke-width="5" '
        f'stroke-linecap="round" fill="none"/>',
        circle(244, 32, 8, BLUE, 3),
    ]))


def ui_kit():
    """The card every screen sits on: 9-slice (32 px), paper, ink, hard offset shadow."""
    defs = halftone("dots", INK, 5, 1.2)
    return svg(96, 96, "".join([
        path("M10 10h82v82H10Z", INK, 0),
        path("M4 4h82v82H4Z", PINK, 0),
        path("M2 2h82v82H2Z", PAPER, 4),
        f'<path d="M2 2h30v30H2Z" fill="url(#dots)" opacity="0.35"/>',
        line(54, 8, 78, 8, 3, BLUE), line(78, 8, 78, 24, 3, BLUE),
        line(8, 78, 30, 78, 3, PINK),
        circle(8, 8, 2.5, INK, 0),
    ]), defs, extra=' data-slice="32"')


ICON = 'fill="none" stroke="#1C1A17" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"'


def icon(body):
    return svg(48, 48, body)


ICONS = {
    "play": icon(f'<circle cx="24" cy="24" r="20" {ICON}/>'
                 f'<path d="M19 15L33 24L19 33Z" fill="{INK}" stroke="{INK}" stroke-width="3" '
                 f'stroke-linejoin="round"/>'
                 f'<path d="M11 17A14 14 0 0 1 17 11" {ICON.replace('="5"', '="3"')}/>'),
    "pause": icon(f'<circle cx="24" cy="24" r="20" {ICON}/>'
                  f'<rect x="15" y="14" width="6" height="20" rx="1.5" fill="{INK}"/>'
                  f'<rect x="27" y="14" width="6" height="20" rx="1.5" fill="{INK}"/>'),
    "retry": icon(f'<path d="M38 24A14 14 0 1 1 33 13" {ICON}/>'
                  f'<path d="M26 6L36 12L28 20Z" fill="{INK}" stroke="{INK}" stroke-width="3" '
                  f'stroke-linejoin="round"/>'
                  f'<circle cx="24" cy="24" r="3.5" fill="{INK}"/>'),
    "menu": icon(f'<path d="M9 13H39" {ICON}/><path d="M9 24H39" {ICON}/>'
                 f'<path d="M9 35H39" {ICON}/>'),
    "sound": icon(f'<path d="M7 18H15L25 9V39L15 30H7Z" fill="{INK}" stroke="{INK}" '
                  f'stroke-width="3" stroke-linejoin="round"/>'
                  f'<path d="M31 17A9 9 0 0 1 31 31" {ICON}/>'
                  f'<path d="M36 11A17 17 0 0 1 36 37" {ICON}/>'),
    "ad": icon(f'<rect x="5" y="13" width="38" height="27" rx="5" {ICON}/>'
               f'<path d="M20 20L31 26.5L20 33Z" fill="{INK}"/>'
               f'<path d="M17 6L24 12L31 6" {ICON.replace('="5"', '="4"')}/>'),
}
ICON_ORDER = ["play", "pause", "retry", "menu", "sound", "ad"]


# --- the font-dependent part: wordmark paths, WOFF2 subsets ---------------------------------


def glyph_paths(font_path, text, size, x, y, tracking=0):
    """SVG path data of `text` in the font, baseline at y, left at x; and the advance."""
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont

    font = TTFont(font_path)
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = size / font["head"].unitsPerEm
    out, cursor = [], x
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, cursor, y)))
        out.append(pen.getCommands())
        cursor += glyphs[name].width * scale + tracking
    return " ".join(out), cursor - x - tracking


def wordmark():
    bungee = os.path.join(FONT_DIR, WORDMARK_FONT)
    w, h = 720, 330
    # Sized so the longest line fits inside the banner's width with a margin.
    _, natural = glyph_paths(bungee, "TOWER MERGE", 100, 0, 0, 2)
    size = 100 * 640 / natural
    top, top_w = glyph_paths(bungee, "TOWER MERGE", size, 0, 0, 2)
    rush, rush_w = glyph_paths(bungee, "RUSH", 112, 0, 0, 6)
    tx = (w - top_w) / 2
    rx = (w - rush_w) / 2

    def lettering(d, fill, offset, x, y):
        t = f"translate({x:.1f} {y})"
        o = f"translate({x + offset[0]:.1f} {y + offset[1]})"
        return (f'<path d="{d}" transform="{o}" fill="{offset[2]}"/>'
                f'<path d="{d}" transform="{t}" fill="none" stroke="{INK}" stroke-width="12" '
                f'stroke-linejoin="round"/>'
                f'<path d="{d}" transform="{t}" fill="{fill}"/>')

    banner = "M40 196H680L660 236L680 316H40L60 236Z"
    body = "".join([
        f'<path d="{banner}" fill="{INK}" transform="translate(8 8)"/>',
        path(banner, BLUE, 6),
        f'<path d="M70 216H650M84 300H636" stroke="{BLUE_LIGHT}" stroke-width="6" '
        f'stroke-linecap="round" fill="none"/>',
        lettering(top, PINK, (6, 5, BLUE), tx, 150),
        lettering(rush, SUN, (6, 5, PINK), rx, 296),
        circle(30, 84, 6, PINK, 0), circle(690, 78, 5, BLUE, 0), circle(704, 100, 4, PURPLE, 0),
    ])
    return svg(w, 260, body, view="0 66 720 260", extra=' data-wgf-off-palette="RUSH is printed in the riso third ink '
               '(sunflower)"')


def fonts():
    from fontTools import subset

    out = os.path.join(ROOT, "fonts")
    os.makedirs(out, exist_ok=True)
    # Latin-1, Cyrillic (ru, uk, be: U+0400-045F, U+0490-0491) and punctuation.
    unicodes = ("U+0020-007E,U+00A0-00FF,U+0400-045F,U+0490-0491,U+2010-2027,U+2032-2033,"
                "U+20AC,U+2116,U+2122,U+00D7")
    for family, (ttf, ofl) in FONT_SOURCES.items():
        options = subset.Options()
        options.flavor = "woff2"
        options.layout_features = ["*"]
        options.name_IDs = ["*"]
        options.notdef_outline = True
        font = subset.load_font(os.path.join(FONT_DIR, ttf), options)
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=subset.parse_unicodes(unicodes))
        subsetter.subset(font)
        subset.save_font(font, os.path.join(out, f"{family}.woff2"), options)
        with open(os.path.join(FONT_DIR, ofl), encoding="utf-8") as src:
            text = src.read()
        with open(os.path.join(out, f"{family}-OFL.txt"), "w", encoding="utf-8") as dst:
            dst.write(text)


def write(relative, text):
    target = os.path.join(ROOT, relative)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def main():
    for n, make in enumerate(PIECES, start=1):
        write(f"svg/pieces/piece-{n}.svg", make())
    write("svg/board/track-frame.svg", track_frame())
    write("svg/board/backdrop.svg", backdrop())
    write("svg/vfx/merge-burst.svg", merge_burst())
    write("svg/vfx/merge-streak.svg", merge_streak())
    write("svg/ui/ui-kit.svg", ui_kit())
    for name in ICON_ORDER:
        write(f"svg/icons/{name}.svg", ICONS[name])
    if "--no-fonts" not in sys.argv:
        write("svg/ui/wordmark.svg", wordmark())
        fonts()


if __name__ == "__main__":
    main()
