"""Klipp ut boss-paneler ur de två fantasy-collagen Christopher genererade."""
from PIL import Image
import os

DOWNLOADS = r"C:\Users\alekj\Downloads"
ASSETS = r"C:\Users\alekj\Desktop\Jimmy-Mourad-Web\assets"

# Källa 1: GAME BOSS CONCEPTS (med rubrik längst upp)
# Layout: 2x2 grid efter en svart header-rad
# - top-left: Molten Warlord
# - top-right: Plague Bringer
# - bottom-left: Cyber-Abomination
# - bottom-right: Cursed Overseer
src1 = os.path.join(DOWNLOADS, "Kan_du_ta_bort_hans_uniform_oc_Nano_Banana_2_24490.png")

# Källa 2: 4-grid utan rubrik
# - top-left: Hooded Wizard
# - top-right: Rusty Knight
# - bottom-left: Cyber Soldier
# - bottom-right: Demon Warrior
src2 = os.path.join(DOWNLOADS, "Kan_du_ta_bort_hans_uniform_oc_Nano_Banana_2_21675.png")

os.makedirs(ASSETS, exist_ok=True)

def crop_2x2(path, names, header_frac=0.0):
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    print(f"Source: {path} ({w}x{h})")
    header_px = int(h * header_frac)
    grid_h = h - header_px
    cw = w // 2
    ch = grid_h // 2
    boxes = [
        (0,        header_px,           cw,    header_px + ch),  # top-left
        (cw,       header_px,           w,     header_px + ch),  # top-right
        (0,        header_px + ch,      cw,    h),               # bottom-left
        (cw,       header_px + ch,      w,     h),               # bottom-right
    ]
    out = []
    for box, name in zip(boxes, names):
        crop = img.crop(box)
        # spara
        path_out = os.path.join(ASSETS, name + ".png")
        crop.save(path_out)
        out.append(path_out)
        print(f"  -> {path_out} ({crop.size[0]}x{crop.size[1]})")
    return out

# GAME BOSS CONCEPTS har en mörk rubrik-rad ~5% av bildhöjden
crop_2x2(src1, ["concept_molten_warlord", "concept_plague_bringer",
                "concept_cyber_abomination", "concept_cursed_overseer"],
         header_frac=0.05)

# Den andra collagen har ingen rubrik
crop_2x2(src2, ["concept_hooded_wizard", "concept_rusty_knight",
                "concept_cyber_soldier", "concept_demon_warrior"],
         header_frac=0.0)

# Mappa de 3 utvalda bossarna till deras boss_<key>.png-filer
import shutil
shutil.copy(os.path.join(ASSETS, "concept_molten_warlord.png"),
            os.path.join(ASSETS, "boss_general.png"))
shutil.copy(os.path.join(ASSETS, "concept_plague_bringer.png"),
            os.path.join(ASSETS, "boss_skuggan.png"))
shutil.copy(os.path.join(ASSETS, "concept_cursed_overseer.png"),
            os.path.join(ASSETS, "boss_jimmy.png"))
print("\nKopierade utvalda bossar:")
print("  boss_general.png  <- Molten Warlord")
print("  boss_skuggan.png  <- Plague Bringer")
print("  boss_jimmy.png    <- Cursed Overseer")
