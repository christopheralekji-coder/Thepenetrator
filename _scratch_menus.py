import os
from google import genai
from google.genai import types
from PIL import Image
client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
OUT = r"C:\Users\alekj\Desktop\Jimmy-Mourad-Web\assets\menu"
style = Image.open(os.path.join(OUT, "warparty-menubg.jpg"))
SAFETY = [types.SafetySetting(category=c, threshold="BLOCK_ONLY_HIGH") for c in
          ["HARM_CATEGORY_DANGEROUS_CONTENT","HARM_CATEGORY_HATE_SPEECH",
           "HARM_CATEGORY_SEXUALLY_EXPLICIT","HARM_CATEGORY_HARASSMENT"]]
COMMON = (" Use the attached image as the STYLE reference (same flat cartoon look, palette and cool "
"sunglasses-wearing cartoon characters). Wide 16:9. Keep the CENTER noticeably DARKER, calmer and more OPEN "
"so menu UI (panels, buttons, text) sits on top and stays readable; put the themed objects/characters more "
"toward the edges. Flat cartoon style. NO text, NO logo, NO UI, no words anywhere.")
JOBS = {
 "bg-shop.jpg": "A WARPARTY weapons SHOP / armory scene: wooden crates overflowing with cartoon guns and "
   "ammo, stacks and piles of shiny GOLD COINS, a merchant stall, shelves of gear, price-tag and neon shop "
   "glow. One or two cool cartoon soldier guys browsing the weapons." + COMMON,
 "bg-wardrobe.jpg": "A WARPARTY fashion / locker-room scene: several cool cartoon soldier characters POSING "
   "and showing off different awesome OUTFITS (tactical gear, knight armor, a food-mascot costume) on a small "
   "runway in front of lockers, a big mirror and clothing racks, with spotlights." + COMMON,
 "bg-ach.jpg": "A WARPARTY victory / TROPHY hall: big shiny GOLD TROPHIES and medals on pedestals, ribbons, "
   "a winners podium, falling confetti, one cartoon soldier guy celebrating with a trophy raised, warm "
   "golden triumphant lighting." + COMMON,
 "bg-settings.jpg": "A calm WARPARTY workshop / tech bench: mechanical GEARS, wrenches, dials and sliders, "
   "a control panel with glowing buttons, a cartoon soldier guy calmly tinkering with equipment, muted cool "
   "blue low-key lighting (this is a settings screen, keep it calm and not too busy)." + COMMON,
}
for dst, prompt in JOBS.items():
    try:
        resp = client.models.generate_content(model="gemini-3-pro-image-preview", contents=[style, prompt],
            config=types.GenerateContentConfig(response_modalities=["IMAGE","TEXT"],
                image_config=types.ImageConfig(aspect_ratio="16:9"), safety_settings=SAFETY))
        got=False
        for part in resp.candidates[0].content.parts:
            if getattr(part,"inline_data",None) and part.inline_data.mime_type.startswith("image/"):
                open(os.path.join(OUT,dst.replace('.jpg','-raw.png')),"wb").write(part.inline_data.data); print("OK",dst,len(part.inline_data.data)); got=True; break
        if not got: print("NO IMAGE",dst)
    except Exception as e:
        print("ERR",dst,str(e)[:120])
print("DONE")
