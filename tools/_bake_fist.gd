# Engångs-bake: rasterar fists.svg/knuckles.svg (4x supersample → 96x96 Lanczos)
# till WarParty-V2/assets/weapons/. Körs headless utanför spelprojektet:
#   Godot_console.exe --headless --path WarParty-V2 --script <absolut sökväg hit>
extends SceneTree

const SRC := "C:/Users/alekj/Desktop/Jimmy-Mourad-Web/tools/_fist_preview/"
const DST := "C:/Users/alekj/Desktop/WarParty-V2/assets/weapons/"

func _init() -> void:
	# [svg-namn, mål-png (absolut), supersample-skala, slutstorlek]
	for spec in [
		["fists",    DST + "fists.png",    4.0, 96],
		["knuckles", DST + "knuckles.png", 4.0, 96],
		["btn_fire", "C:/Users/alekj/Desktop/WarParty-V2/assets/hud/btn_fire.png", 2.0, 336],
	]:
		var f := FileAccess.open(SRC + str(spec[0]) + ".svg", FileAccess.READ)
		if f == null:
			push_error("saknar " + str(spec[0]) + ".svg"); quit(1); return
		var img := Image.new()
		var err := img.load_svg_from_string(f.get_as_text(), spec[2])
		if err != OK:
			push_error("SVG-raster fail %s: %d" % [spec[0], err]); quit(1); return
		img.convert(Image.FORMAT_RGBA8)
		img.resize(spec[3], spec[3], Image.INTERPOLATE_LANCZOS)
		err = img.save_png(str(spec[1]))
		if err != OK:
			push_error("save fail %s: %d" % [spec[0], err]); quit(1); return
		print("OK  %s (%dx%d)" % [spec[1], spec[3], spec[3]])
	quit(0)
