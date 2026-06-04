# Genererar app-ikon-kandidater i SAMMA tema som meny-bakgrunderna (flat cartoon,
# Gemini 3 Pro Image, warparty-menubg.jpg som stil-referens). Kvadratiskt (1:1).
# Koncept: banan håller UPP original-hjälten med en BANAN; hjälten gömmer riktig
# pistol bakom ryggen; explosioner + rök bakom. INGEN text/logo (iOS lägger på namnet).
import os
from google import genai
from google.genai import types
from PIL import Image

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "resources", "icon-candidates")
os.makedirs(OUT, exist_ok=True)
style = Image.open(os.path.join(ROOT, "assets", "menu", "warparty-menubg.jpg"))

SAFETY = [types.SafetySetting(category=c, threshold="BLOCK_ONLY_HIGH") for c in
          ["HARM_CATEGORY_DANGEROUS_CONTENT", "HARM_CATEGORY_HATE_SPEECH",
           "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_HARASSMENT"]]

COMMON = (" Use the attached image as the STYLE reference: SAME flat cartoon look, SAME color palette, SAME "
  "cool cartoon characters wearing sunglasses. This is a MOBILE GAME APP ICON: square 1:1, the two characters "
  "are the BOLD central subject and FILL the frame, strong high-contrast dramatic action-movie lighting, vibrant "
  "and punchy, readable even when small. Keep the characters CENTERED (corners may get rounded off on a phone). "
  "Flat cartoon style. ABSOLUTELY NO text, NO letters, NO logo, NO words, NO UI anywhere.")

SCENE = ("A funny action STAND-OFF between two cartoon characters facing each other: "
  "LEFT — a goofy but tough anthropomorphic BANANA character (a yellow banana with cartoon arms, legs and face, "
  "wearing cool sunglasses) holding a SECOND banana like it is a gun and aiming it threateningly at the hero. "
  "RIGHT — the WARPARTY HERO, a cool cartoon soldier guy in a CLASSIC military hero outfit (green/khaki, the "
  "original protagonist) wearing sunglasses, looking calm and smug while SECRETLY hiding a real metal PISTOL "
  "behind his back, about to turn the tables. Between and behind them: dramatic orange EXPLOSIONS, drifting grey "
  "SMOKE, glowing embers and sparks — stylish and cinematic.")

JOBS = {
 "standoff-1.png": SCENE + COMMON,
 "standoff-2.png": SCENE + " Slightly more zoomed-in, both characters from the waist up, banana on the left." + COMMON,
 "standoff-3.png": SCENE + " Wider heroic full-body composition, big explosion bloom right in the center behind them." + COMMON,
}

for dst, prompt in JOBS.items():
    try:
        resp = client.models.generate_content(
            model="gemini-3-pro-image-preview", contents=[style, prompt],
            config=types.GenerateContentConfig(response_modalities=["IMAGE", "TEXT"],
                image_config=types.ImageConfig(aspect_ratio="1:1"), safety_settings=SAFETY))
        got = False
        for part in resp.candidates[0].content.parts:
            if getattr(part, "inline_data", None) and part.inline_data.mime_type.startswith("image/"):
                open(os.path.join(OUT, dst), "wb").write(part.inline_data.data)
                print("OK", dst, len(part.inline_data.data)); got = True; break
        if not got:
            print("NO IMAGE", dst)
    except Exception as e:
        print("ERR", dst, str(e)[:140])
print("DONE -> resources/icon-candidates/")
