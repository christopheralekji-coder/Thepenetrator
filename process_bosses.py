"""Beskär boss-bilderna runt karaktären och lägg till alfa-vignett (rund mask)
så de inte längre ser ut som fyrkanter i spelet."""
from PIL import Image, ImageDraw, ImageFilter
import os

ASSETS = r"C:\Users\alekj\Desktop\Jimmy-Mourad-Web\assets"

def make_full_body(src_path, dst_path, crop_top_pct=0.0, crop_bottom_pct=0.0,
                   crop_side_pct=0.0, feather=30):
    """Behåll helkropp (huvud + torso + ben). Mask = vertikal kapsel."""
    img = Image.open(src_path).convert("RGBA")
    w, h = img.size
    left   = int(w * crop_side_pct)
    right  = w - left
    top    = int(h * crop_top_pct)
    bottom = h - int(h * crop_bottom_pct)
    img = img.crop((left, top, right, bottom))
    iw, ih = img.size
    # vertikal kapsel-mask: rounded rectangle med stor radie
    mask = Image.new("L", (iw, ih), 0)
    draw = ImageDraw.Draw(mask)
    radius = int(iw * 0.25)
    draw.rounded_rectangle((iw*0.10, ih*0.02, iw*0.90, ih*0.98),
                           radius=radius, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather))
    out = img.copy()
    out.putalpha(mask)
    out.save(dst_path)
    print(f"  -> {dst_path} ({iw}x{ih})")

# Bakåtkompatibilitet
make_circular = make_full_body

# Crop-parametrar för att behålla HELKROPP (mer höjd, mindre side-crop)
configs = {
    "boss_general.png":  ("concept_molten_warlord.png",   0.02, 0.02, 0.05),
    "boss_skuggan.png":  ("concept_plague_bringer.png",   0.02, 0.02, 0.05),
    "boss_jimmy.png":    ("concept_cursed_overseer.png",  0.02, 0.02, 0.05),
}

for dst_name, (src_name, top, bottom, side) in configs.items():
    src = os.path.join(ASSETS, src_name)
    dst = os.path.join(ASSETS, dst_name)
    if not os.path.exists(src):
        print(f"SKIP (saknas): {src}")
        continue
    make_circular(src, dst, top, bottom, side, feather=35)

print("Klart.")
