#!/usr/bin/env python3
"""Draws Bitty's mark: a solid disc with a dark tick cut across it.

The mark used to be a ring with the tick inside it, which at tray size
collapsed into an indistinct blob: the ring and the tick were the same
colour and only a couple of pixels wide, so there was nothing to read. A
solid disc holds its shape at 16px, and a dark tick on top stays legible
against every disc colour.

Writes the app icon, the website's copies, and the tray theme, so every
place the mark appears comes from one definition.
"""
from PIL import Image, ImageDraw

DARK = (17, 24, 39, 255)      # the tick, on every variant
YELLOW = (251, 199, 17, 255)  # brand, used for the app and website mark
GREEN = (75, 174, 79, 255)
AMBER = (255, 192, 6, 255)
RED = (243, 66, 54, 255)
WHITE = (250, 250, 250, 255)

# Drawn large and scaled down: the tick is diagonal, and antialiasing it by
# supersampling is what keeps the corners clean at 16px.
SUPER = 16


def mark(size, disc):
    s = size * SUPER
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    pad = s * 0.02
    d.ellipse([pad, pad, s - pad, s - pad], fill=disc)

    # Tick geometry as a fraction of the disc, so it scales with it.
    width = int(s * 0.115)
    points = [(s * 0.28, s * 0.52), (s * 0.44, s * 0.68), (s * 0.73, s * 0.34)]
    d.line(points, fill=DARK, width=width, joint="curve")
    # Round the ends; ImageDraw.line leaves them square.
    for x, y in (points[0], points[2]):
        r = width / 2
        d.ellipse([x - r, y - r, x + r, y + r], fill=DARK)

    return img.resize((size, size), Image.LANCZOS)


def save(img, path):
    from pathlib import Path
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    print("wrote", path)


if __name__ == "__main__":
    save(mark(512, YELLOW), "build/icon.png")
    # The window's own icon. Without it the taskbar and alt-tab fall back
    # to the desktop's generic application icon (a cog on Cinnamon).
    save(mark(256, YELLOW), "renderer/assets/icon.png")
    save(mark(512, YELLOW), "docs/assets/icon-512.png")
    save(mark(180, YELLOW), "docs/assets/apple-touch-icon.png")
    save(mark(32, YELLOW), "docs/assets/favicon-32.png")

    states = {"connected": GREEN, "connecting": AMBER, "disconnected": RED}
    for size in (16, 22, 24, 32, 48, 64):
        for state, colour in states.items():
            base = f"renderer/assets/tray-theme/hicolor/{size}x{size}/apps/bitty-tray"
            save(mark(size, colour), f"{base}-{state}.png")
            # The mono variant is for panels that want one flat colour; the
            # status still reads from the tick being present, not its hue.
            save(mark(size, WHITE), f"{base}-mono-{state}.png")
