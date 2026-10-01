"""Build the body face: Commissioner 500, instanced and subset to Latin + Cyrillic as WOFF2.

GOLDEN-RUN FIXTURE. The design's neon-drift typography names Instrument Sans for its body,
which has no Cyrillic; for a title with ru in scope the identity kit swaps in Commissioner
(the Factory's scripts/wgf_design/identity.py ALTERNATES), so this library ships that face.
Unbounded 800 and JetBrains Mono 700 were built the same way and are not rebuilt here.

Source: github.com/google/fonts ofl/commissioner, Commissioner[FLAR,VOLM,slnt,wght].ttf and
OFL.txt (SIL Open Font License 1.1), read from WGF_FONT_SOURCE_DIR. Needs fontTools and
brotli:  python3 make-fonts.py  ->  commissioner-500.woff2 and OFL-Commissioner.txt beside it.
"""

import os
import shutil

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE_DIR = os.environ.get("WGF_FONT_SOURCE_DIR", "/tmp/wgf-dui/fonts")
SOURCE = "commissioner_Commissioner[FLAR,VOLM,slnt,wght].ttf"
LICENCE = "commissioner_OFL.txt"
# Static instance: the default flare, volume and slant; the design's 500 weight.
AXES = {"FLAR": 0, "VOLM": 0, "slnt": 0, "wght": 500}
# The same ranges as the other two faces: Latin-1, Cyrillic (ru, uk, be) and punctuation.
UNICODES = ("U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+0400-045F,"
            "U+0490-0491,U+2013-2014,U+2018-201A,U+201C-201E,U+2022,U+2026,U+20AC,U+2122")


def main():
    font = instancer.instantiateVariableFont(
        TTFont(os.path.join(SOURCE_DIR, SOURCE)), AXES, updateFontNames=True)
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(UNICODES))
    subsetter.subset(font)
    subset.save_font(font, os.path.join(HERE, "commissioner-500.woff2"), options)
    shutil.copyfile(os.path.join(SOURCE_DIR, LICENCE), os.path.join(HERE, "OFL-Commissioner.txt"))


if __name__ == "__main__":
    main()
