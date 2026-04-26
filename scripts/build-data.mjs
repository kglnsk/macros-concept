import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SOURCE = resolve("recipes-with-nutrition.csv");
const INDEX_TARGET = resolve("data/recipes-index.json");
const DETAILS_TARGET = resolve("data/recipe-details.json");
const MAX_INGREDIENTS = 10;

const recipes = [];
const details = {};
let headers = null;
let currentField = "";
let currentRecord = [];
let insideQuotes = false;
let skipped = 0;

const index = {
  name: -1,
  source: -1,
  url: -1,
  servings: -1,
  calories: -1,
  totalWeight: -1,
  dietLabels: -1,
  healthLabels: -1,
  cuisineType: -1,
  mealType: -1,
  dishType: -1,
  ingredientLines: -1,
  totalNutrients: -1,
};

for await (const chunk of createReadStream(SOURCE, { encoding: "utf8" })) {
  for (let i = 0; i < chunk.length; i += 1) {
    const char = chunk[i];
    const next = chunk[i + 1];

    if (insideQuotes) {
      if (char === '"' && next === '"') {
        currentField += '"';
        i += 1;
      } else if (char === '"') {
        insideQuotes = false;
      } else {
        currentField += char;
      }
      continue;
    }

    if (char === '"') {
      insideQuotes = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n") {
      pushField();
      consumeRecord(currentRecord);
      currentRecord = [];
    } else if (char !== "\r") {
      currentField += char;
    }
  }
}

if (currentField.length || currentRecord.length) {
  pushField();
  consumeRecord(currentRecord);
}

const ranges = buildRanges(recipes);
const defaults = buildDefaults(recipes);

mkdirSync(dirname(INDEX_TARGET), { recursive: true });
writeFileSync(
  INDEX_TARGET,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: "recipes-with-nutrition.csv",
      count: recipes.length,
      skipped,
      ranges,
      defaults,
      recipes,
    },
    null,
    0
  )
);
writeFileSync(DETAILS_TARGET, JSON.stringify(details, null, 0));

console.log(`Wrote ${recipes.length} recipes to ${INDEX_TARGET}`);
console.log(`Wrote ${Object.keys(details).length} recipe details to ${DETAILS_TARGET}`);
console.log(`Skipped ${skipped} rows`);

function pushField() {
  currentRecord.push(currentField);
  currentField = "";
}

function consumeRecord(record) {
  if (!headers) {
    headers = record;
    mapHeaders(headers);
    return;
  }

  if (record.length !== headers.length) {
    skipped += 1;
    return;
  }

  const parsed = compactRecipe(record);
  if (parsed) {
    recipes.push(parsed.recipe);
    details[parsed.recipe.id] = parsed.detail;
  } else {
    skipped += 1;
  }
}

function mapHeaders(headerRow) {
  index.name = headerRow.indexOf("recipe_name");
  index.source = headerRow.indexOf("source");
  index.url = headerRow.indexOf("url");
  index.servings = headerRow.indexOf("servings");
  index.calories = headerRow.indexOf("calories");
  index.totalWeight = headerRow.indexOf("total_weight_g");
  index.dietLabels = headerRow.indexOf("diet_labels");
  index.healthLabels = headerRow.indexOf("health_labels");
  index.cuisineType = headerRow.indexOf("cuisine_type");
  index.mealType = headerRow.indexOf("meal_type");
  index.dishType = headerRow.indexOf("dish_type");
  index.ingredientLines = headerRow.indexOf("ingredient_lines");
  index.totalNutrients = headerRow.indexOf("total_nutrients");

  const missing = Object.entries(index)
    .filter(([, value]) => value === -1)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`Missing expected columns: ${missing.join(", ")}`);
  }
}

function compactRecipe(record) {
  const weight = Number(record[index.totalWeight]);
  const totalCalories = Number(record[index.calories]);
  const servings = Number(record[index.servings]);

  if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(totalCalories) || totalCalories <= 0) {
    return null;
  }

  let nutrients;
  try {
    nutrients = JSON.parse(record[index.totalNutrients]);
  } catch {
    return null;
  }

  const protein = nutrientQuantity(nutrients, "PROCNT");
  const fat = nutrientQuantity(nutrients, "FAT");
  const carbs = nutrientQuantity(nutrients, "CHOCDF");

  if (![protein, fat, carbs].every((value) => Number.isFinite(value) && value >= 0)) {
    return null;
  }

  const macros = {
    protein: per100(protein, weight),
    fat: per100(fat, weight),
    carbs: per100(carbs, weight),
    calories: per100(totalCalories, weight),
  };

  if (
    macros.protein > 90 ||
    macros.fat > 100 ||
    macros.carbs > 120 ||
    macros.calories > 950 ||
    macros.protein + macros.fat + macros.carbs > 130
  ) {
    return null;
  }

  const id = recipes.length + 1;
  const name = cleanText(record[index.name]) || "Untitled recipe";
  const source = cleanText(record[index.source]);
  const url = record[index.url];
  const cuisine = firstLabel(record[index.cuisineType]);
  const meal = firstLabel(record[index.mealType]);
  const dish = firstLabel(record[index.dishType]);
  const labels = uniqueLabels(
    parseArray(record[index.dietLabels])
      .concat(parseArray(record[index.healthLabels]))
      .concat(parseArray(record[index.cuisineType]))
      .concat(parseArray(record[index.mealType]))
      .concat(parseArray(record[index.dishType]))
  ).slice(0, 14);

  return {
    recipe: {
      id,
      name,
      source,
      cuisine,
      meal,
      dish,
      macros,
    },
    detail: {
      name,
      source,
      url,
      servings: round(servings, 1),
      weight: round(weight, 0),
      totalCalories: round(totalCalories, 0),
      labels,
      ingredients: parseArray(record[index.ingredientLines]).map(cleanText).filter(Boolean).slice(0, MAX_INGREDIENTS),
    },
  };
}

function nutrientQuantity(nutrients, key) {
  return Number(nutrients?.[key]?.quantity);
}

function per100(value, weight) {
  return round((value / weight) * 100, 1);
}

function parseArray(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function firstLabel(raw) {
  return cleanText(parseArray(raw)[0] || "");
}

function uniqueLabels(labels) {
  const seen = new Set();
  const result = [];
  for (const label of labels.map(cleanText).filter(Boolean)) {
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}

function cleanText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildRanges(list) {
  return Object.fromEntries(
    ["protein", "fat", "carbs", "calories"].map((key) => {
      const values = list.map((recipe) => recipe.macros[key]).sort((a, b) => a - b);
      const max = percentile(values, key === "calories" ? 0.98 : 0.97);
      return [key, { min: 0, max: round(Math.max(max, key === "calories" ? 500 : 35), key === "calories" ? 0 : 1) }];
    })
  );
}

function buildDefaults(list) {
  const defaults = Object.fromEntries(
    ["protein", "fat", "carbs", "calories"].map((key) => {
      const values = list.map((recipe) => recipe.macros[key]).sort((a, b) => a - b);
      return [key, round(percentile(values, 0.55), key === "calories" ? 0 : 1)];
    })
  );
  defaults.calories = round(defaults.protein * 4 + defaults.fat * 9 + defaults.carbs * 4, 0);
  return defaults;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor(values.length * ratio)));
  return values[index];
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
