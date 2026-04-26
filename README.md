# Macros

Macros is a static web prototype for an anti-menu restaurant interface: four macro sliders, a fast constraint match, and a deliberately severe recipe reveal. The app normalizes recipe nutrition to per-100g values and finds the closest dishes from a compact browser-side index.

The current visual direction blends experimental fine dining, institutional provocation, and postironic nutrition-app language: no image cards, no lifestyle food photography, just numbers, refusal, and evidence.

## What It Does

- Provides four sliders: protein, fat, carbs, and calories per 100g.
- Couples calories to protein/fat/carbs using the standard 4/9/4 kcal macro model.
- Searches 39,198 usable recipes nearly instantly in the browser.
- Shows the closest matching dish plus nearby alternatives.
- Reveals recipe ingredients, labels, source, and macro stats on demand.
- Avoids image URLs entirely for this prototype.

## Repository Layout

```text
.
├── index.html
├── assets/
│   ├── app.js
│   └── styles.css
├── data/
│   ├── recipes-index.json
│   └── recipe-details.json
├── scripts/
│   └── build-data.mjs
└── README.md
```

`data/recipes-index.json` is the small startup search index. `data/recipe-details.json` is loaded only when a recipe is displayed.

## Run Locally

Use a local HTTP server so browser `fetch()` can load the JSON files:

```bash
python3 -m http.server 4173
```

Open:

```text
http://127.0.0.1:4173/
```

## Rebuild Data

The raw CSV is intentionally ignored by git because it is hundreds of megabytes. To regenerate the compact data files, place `recipes-with-nutrition.csv` in the repository root and run:

```bash
node scripts/build-data.mjs
```

The build script:

- Reads `recipes-with-nutrition.csv`.
- Extracts recipe name, source, URL, serving count, total weight, labels, ingredients, and total nutrients.
- Normalizes protein, fat, carbs, and calories to per-100g values using `total_weight_g`.
- Drops rows with missing or implausible macro data.
- Writes a browser search index and a lazy-loaded detail file.
- Does not include image URLs.

Current generated output:

- `39,198` recipes included
- `249` rows skipped
- `data/recipes-index.json`: about `7.7 MB`
- `data/recipe-details.json`: about `24 MB`

## Dataset

The source dataset is `Recipes With Nutrition`, curated by DataHive and described as 39,447 recipes with structured nutrition, ingredients, labels, and metadata.

Relevant source columns:

- `recipe_name`, `source`, `url`, `servings`, `calories`, `total_weight_g`
- `diet_labels`, `health_labels`, `cuisine_type`, `meal_type`, `dish_type`
- `ingredient_lines`, `total_nutrients`

The dataset license is Creative Commons Non-Commercial 4.0 (`CC BY-NC 4.0`). See [LICENSE](LICENSE) for this repository's license file.

## Notes

This is a static prototype. There is no bundler, framework, package install, or backend. The large CSV should stay out of git; commit the generated files in `data/` when you want the site to work as-is after clone or static deployment.
