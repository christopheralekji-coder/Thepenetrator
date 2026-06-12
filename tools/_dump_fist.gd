# Debug: dumpa vad engine faktiskt laddar för res://assets/weapons/fists.png
extends SceneTree
func _init() -> void:
	var tex: Texture2D = load("res://assets/weapons/fists.png")
	if tex == null:
		push_error("load fail"); quit(1); return
	var img := tex.get_image()
	img.save_png("C:/Users/alekj/Desktop/Jimmy-Mourad-Web/tools/_fist_preview/runtime_fists.png")
	print("OK dumped ", img.get_width(), "x", img.get_height())
	quit(0)
