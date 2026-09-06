"""Render the user's local architectural sheet; never upload the document."""

from pathlib import Path
import json

import pymupdf


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "דורי 50 רעננה.pdf"
OUT = ROOT / "src" / "assets"
OUT.mkdir(parents=True, exist_ok=True)

with pymupdf.open(SOURCE) as document:
    page = document[0]
    preview_scale = 2600 / page.rect.width
    page.get_pixmap(matrix=pymupdf.Matrix(preview_scale, preview_scale), alpha=False).save(
        OUT / "sheet-preview.png"
    )
    words = page.get_text("words")
    (OUT / "sheet-words.json").write_text(
        json.dumps(words, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    crops = {
        "ground-plan": (1300, 130, 2440, 1350),
        "first-plan": (155, 145, 1220, 1320),
        "basement-plan": (2510, 160, 3625, 1320),
        "ground-detail": (1830, 545, 2330, 1250),
        "first-detail": (655, 545, 1050, 1090),
        "north-detail": (3500, 145, 3610, 250),
    }
    for name, bounds in crops.items():
        clip = pymupdf.Rect(bounds)
        factor = 2.4 if "detail" in name else 1.4
        page.get_pixmap(matrix=pymupdf.Matrix(factor, factor), clip=clip, alpha=False).save(
            OUT / f"{name}.png"
        )
        print(name, bounds)
    drawings = page.get_drawings()
    print("BASEMENT WALL BOUNDS")
    for drawing in drawings:
        color = drawing.get("fill")
        rect = drawing["rect"]
        if color and max(color) - min(color) > 0.4 and 3020 < rect.x0 < 3450 and 550 < rect.y0 < 1110:
            print(tuple(round(v, 3) for v in rect), len(drawing["items"]))

    # 11.45 m clear dimension printed on the ground plan, between inner faces.
    points_per_metre = (2205.09814453125 - 1880.109375) / 11.45
    level_bounds = {
        "ground": (1865, 595, 2220, 1070, 1873.864990234375, 605.254150390625),
        "first": (660, 595, 1025, 1070, 667.77, 605.254150390625),
        "basement": (3040, 570, 3450, 1112, 3049.70166015625, 618.6416015625),
    }

    def solid_intervals(drawing, horizontal):
        rect = drawing["rect"]
        cut = (rect.y0 + rect.y1) / 2 if horizontal else (rect.x0 + rect.x1) / 2
        crossings = []
        for item in drawing["items"]:
            if item[0] != "l":
                continue
            a, b = item[1:3]
            a_cross, b_cross = (a.y, b.y) if horizontal else (a.x, b.x)
            a_axis, b_axis = (a.x, b.x) if horizontal else (a.y, b.y)
            if min(a_cross, b_cross) <= cut < max(a_cross, b_cross):
                crossings.append(a_axis + (cut - a_cross) / (b_cross - a_cross) * (b_axis - a_axis))
        crossings.sort()
        return list(zip(crossings[0::2], crossings[1::2]))

    exported = {"pointsPerMetre": points_per_metre, "levels": {}}
    for level, (x0, y0, x1, y1, ox, oy) in level_bounds.items():
        walls = []
        for drawing in drawings:
            rect = drawing["rect"]
            color = drawing.get("fill")
            if not (color and max(color) - min(color) > 0.4 and x0 <= rect.x0 and rect.x1 <= x1 and y0 <= rect.y0 and rect.y1 <= y1):
                continue
            horizontal = rect.width > rect.height
            thickness = min(rect.width, rect.height) / points_per_metre
            if not (0.055 < thickness < 0.46):
                continue
            intervals = solid_intervals(drawing, horizontal)
            start = rect.x0 if horizontal else rect.y0
            end = rect.x1 if horizontal else rect.y1
            gaps = []
            cursor = start
            for lo, hi in intervals:
                if lo - cursor > points_per_metre * 0.38:
                    gaps.append({"center": ((lo + cursor) / 2 - start) / points_per_metre, "width": (lo - cursor) / points_per_metre})
                cursor = max(cursor, hi)
            if end - cursor > points_per_metre * 0.38:
                gaps.append({"center": ((end + cursor) / 2 - start) / points_per_metre, "width": (end - cursor) / points_per_metre})
            if horizontal:
                a = [(rect.x0 - ox) / points_per_metre, ((rect.y0 + rect.y1) / 2 - oy) / points_per_metre]
                b = [(rect.x1 - ox) / points_per_metre, a[1]]
            else:
                a = [((rect.x0 + rect.x1) / 2 - ox) / points_per_metre, (rect.y0 - oy) / points_per_metre]
                b = [a[0], (rect.y1 - oy) / points_per_metre]
            wall = {"id": f"{level}-wall-{len(walls)}", "a": [round(v, 5) for v in a], "b": [round(v, 5) for v in b], "thickness": round(thickness, 5), "gaps": [{k: round(v, 5) for k, v in gap.items()} for gap in gaps]}
            walls.append(wall)
        exported["levels"][level] = {"origin": [ox, oy], "walls": walls}
        print(level, "walls", len(walls), "openings", sum(len(w["gaps"]) for w in walls))
    (OUT / "traced-walls.json").write_text(json.dumps(exported, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Sheet: {page.rect}; words: {len(words)}; preview: {OUT / 'sheet-preview.png'}")