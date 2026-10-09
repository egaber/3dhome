"""Render the user's local architectural sheet; never upload the document."""

from pathlib import Path
import json

import pymupdf


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "דורי 50 רעננה.pdf"
GROUND_SOURCE = ROOT / "קומת קרקע.pdf"
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
            if item[0] == "re":
                bounds = item[1]
                if (bounds.y0 <= cut < bounds.y1) if horizontal else (bounds.x0 <= cut < bounds.x1):
                    crossings.extend([bounds.x0, bounds.x1] if horizontal else [bounds.y0, bounds.y1])
                continue
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

if GROUND_SOURCE.exists():
    (OUT / "legacy-ground-walls.json").write_text(
        json.dumps(exported["levels"]["ground"], ensure_ascii=False, indent=2), encoding="utf-8"
    )
    with pymupdf.open(GROUND_SOURCE) as document:
        page = document[0]
        drawings = page.get_drawings()
        ground_drawings = [
            drawing for drawing in drawings
            if drawing.get("fill") in [(1.0, 0.0, 0.0), (0.0, 0.5019699931144714, 1.0), (0.0, 1.0, 0.5019699931144714)]
            and 570 < drawing["rect"].x0 < 920 and 475 < drawing["rect"].y0 < 940
        ]
        facade = ground_drawings[0]["rect"]
        thickness = facade.height
        scale = (facade.width - 2 * thickness) / 11.45
        origin = [facade.x0, facade.y0]
        crop = [540, 125, 1015, 1120]
        source_ids = [0, 1, 2, 34, 4, 5, 6, 9, 10, 11, 12, 13, 14, 16, 18, 24,
                  25, 21, 22, 3, 27, 28, 29, 30, 31, 32, 35, 33]
        if len(ground_drawings) != len(source_ids):
            raise ValueError(f"Unexpected revised wall count: {len(ground_drawings)}")
        walls = []
        for source_id, drawing in zip(source_ids, ground_drawings):
            rect = drawing["rect"]
            horizontal = rect.width > rect.height
            start = rect.x0 if horizontal else rect.y0
            end = rect.x1 if horizontal else rect.y1
            cursor = start
            gaps = []
            for low, high in solid_intervals(drawing, horizontal):
                if low - cursor > scale * 0.38:
                    gaps.append({"center": ((low + cursor) / 2 - start) / scale, "width": (low - cursor) / scale})
                cursor = max(cursor, high)
            if end - cursor > scale * 0.38:
                gaps.append({"center": ((end + cursor) / 2 - start) / scale, "width": (end - cursor) / scale})
            if horizontal:
                first = [(rect.x0 - origin[0]) / scale, ((rect.y0 + rect.y1) / 2 - origin[1]) / scale]
                last = [(rect.x1 - origin[0]) / scale, first[1]]
            else:
                first = [((rect.x0 + rect.x1) / 2 - origin[0]) / scale, (rect.y0 - origin[1]) / scale]
                last = [first[0], (rect.y1 - origin[1]) / scale]
            shared = source_id in [3, 13, 18, 27, 28, 32]
            units = ["north", "south"] if shared else ["south"] if source_id in [4, 5, 6, 14, 24, 25, 29, 30, 31] else ["north"]
            if source_id == 1:
                units = ["north", "south"]
            walls.append({"id": f"ground-wall-{source_id}", "a": [round(value, 5) for value in first],
                          "b": [round(value, 5) for value in last], "thickness": round(min(rect.width, rect.height) / scale, 5),
                          "units": units, "shared": shared, "splitAtParty": source_id == 1,
                          "exterior": source_id in [0, 1, 2, 4, 5, 6, 10, 11, 12, 14],
                          "gaps": [{key: round(value, 5) for key, value in gap.items()} for gap in gaps]})
        exported["levels"]["ground"] = {"origin": origin, "pointsPerMetre": scale, "crop": crop,
                                           "revision": GROUND_SOURCE.name, "walls": walls}
        page.get_pixmap(matrix=pymupdf.Matrix(1.4, 1.4), clip=pymupdf.Rect(crop), alpha=False).save(OUT / "ground-plan.png")
        page.get_pixmap(matrix=pymupdf.Matrix(2.4, 2.4), clip=pymupdf.Rect(565, 470, 920, 940), alpha=False).save(OUT / "ground-detail.png")
        (OUT / "traced-walls.json").write_text(json.dumps(exported, ensure_ascii=False, indent=2), encoding="utf-8")
        print("REVISED GROUND", "scale", scale, "origin", origin)
        for wall in walls:
            print(wall)