const INDEX_URL = "data/recipes-index.json";
const DETAILS_URL = "data/recipe-details.json";
const MACRO_KEYS = ["protein", "fat", "carbs", "calories"];
const DISPLAY_LABELS = {
  protein: "Protein",
  fat: "Fat",
  carbs: "Carbs",
  calories: "Calories",
};
const VERDICTS = [
  "Compliance, unfortunately",
  "This is technically food",
  "Constraint accepted. Appetite unconsulted",
  "Hard yes from the machine",
  "The dish has passed peer review",
  "Bestie, the kitchen said math",
];

const controls = Object.fromEntries(
  MACRO_KEYS.map((key) => [key, document.getElementById(key)])
);
const outputs = Object.fromEntries(
  MACRO_KEYS.map((key) => [key, document.getElementById(`${key}-value`)])
);

const state = {
  recipes: [],
  details: null,
  matches: [],
  selected: null,
  targets: {
    protein: 18,
    fat: 12,
    carbs: 22,
    calories: 268,
  },
  pendingFrame: 0,
  lastChanged: "protein",
};

const els = {
  status: document.getElementById("status"),
  verdict: document.getElementById("verdict"),
  matchName: document.getElementById("match-name"),
  matchMeta: document.getElementById("match-meta"),
  matchMacros: document.getElementById("match-macros"),
  matchScore: document.getElementById("match-score"),
  recipeButton: document.getElementById("recipe-button"),
  details: document.getElementById("details"),
  detailsName: document.getElementById("details-name"),
  detailsLink: document.getElementById("details-link"),
  ingredientList: document.getElementById("ingredient-list"),
  statsList: document.getElementById("stats-list"),
  labelList: document.getElementById("label-list"),
  recipeList: document.getElementById("recipe-list"),
};

init();

async function init() {
  bindControls();
  updateOutputs();

  try {
    const response = await fetch(INDEX_URL);
    if (!response.ok) {
      throw new Error(`Unable to load ${INDEX_URL}`);
    }
    const payload = await response.json();
    state.recipes = payload.recipes;
    applyRanges(payload.ranges);
    state.targets = { ...payload.defaults };
    syncInputs();
    updateOutputs();
    computeMatches();
    els.status.textContent = `${state.recipes.length.toLocaleString()} constraints indexed`;
  } catch (error) {
    els.status.textContent = "Dataset unavailable";
    els.matchName.textContent = "Run scripts/build-data.mjs";
    els.matchMeta.textContent = error.message;
  }
}

function bindControls() {
  MACRO_KEYS.forEach((key) => {
    controls[key].addEventListener("input", () => {
      state.lastChanged = key;
      state.targets[key] = Number(controls[key].value);
      coupleEnergy(key);
      updateOutputs();
      scheduleMatch();
    });
  });

  els.recipeButton.addEventListener("click", () => {
    if (state.selected) {
      renderDetails(state.selected);
    }
  });
}

function applyRanges(ranges = {}) {
  MACRO_KEYS.forEach((key) => {
    if (!ranges[key]) return;
    controls[key].min = String(ranges[key].min);
    controls[key].max = String(ranges[key].max);
    controls[key].step = key === "calories" ? "1" : "0.1";
  });
}

function syncInputs() {
  MACRO_KEYS.forEach((key) => {
    controls[key].value = String(state.targets[key]);
  });
}

function coupleEnergy(changedKey) {
  const targets = state.targets;
  if (changedKey === "calories") {
    const remaining = targets.calories - targets.protein * 4 - targets.carbs * 4;
    const nextFat = clamp(remaining / 9, Number(controls.fat.min), Number(controls.fat.max));
    targets.fat = round(nextFat, 1);
    controls.fat.value = String(targets.fat);
    return;
  }

  const calories = targets.protein * 4 + targets.fat * 9 + targets.carbs * 4;
  targets.calories = round(clamp(calories, Number(controls.calories.min), Number(controls.calories.max)), 0);
  controls.calories.value = String(targets.calories);
}

function scheduleMatch() {
  if (state.pendingFrame) return;
  document.querySelector(".match-panel")?.classList.add("is-deciding");
  state.pendingFrame = requestAnimationFrame(() => {
    state.pendingFrame = 0;
    computeMatches();
    window.setTimeout(() => document.querySelector(".match-panel")?.classList.remove("is-deciding"), 90);
  });
}

function computeMatches() {
  if (!state.recipes.length) return;

  const target = state.targets;
  const scored = [];
  for (const recipe of state.recipes) {
    const macros = recipe.macros;
    const score =
      squared((macros.protein - target.protein) / 12) +
      squared((macros.fat - target.fat) / 12) +
      squared((macros.carbs - target.carbs) / 18) +
      squared((macros.calories - target.calories) / 110);

    insertCandidate(scored, { recipe, score }, 7);
  }

  state.matches = scored;
  state.selected = scored[0].recipe;
  renderPrimary(scored[0]);
  renderAlternates(scored.slice(1));
}

function insertCandidate(list, candidate, limit) {
  const index = list.findIndex((item) => candidate.score < item.score);
  if (index === -1) {
    if (list.length < limit) list.push(candidate);
    return;
  }
  list.splice(index, 0, candidate);
  if (list.length > limit) list.pop();
}

function renderPrimary(candidate) {
  const recipe = candidate.recipe;
  els.matchName.textContent = recipe.name;
  els.matchMeta.textContent = compactMeta(recipe);
  const fit = Math.max(0, 100 - candidate.score * 18);
  els.matchScore.textContent = `${fit.toFixed(0)}% fit`;
  els.verdict.textContent = verdictFor(fit, recipe.id);
  els.matchMacros.replaceChildren(...macroTiles(recipe.macros));
  els.recipeButton.disabled = false;
}

function renderAlternates(candidates) {
  const cards = candidates.map(({ recipe, score }) => {
    const card = document.createElement("article");
    card.className = "recipe-card";

    const title = document.createElement("h3");
    title.textContent = recipe.name;

    const summary = document.createElement("p");
    summary.textContent = `${compactMeta(recipe)} / ${Math.max(0, 100 - score * 18).toFixed(0)}% fit / not canon`;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "View evidence";
    button.addEventListener("click", () => {
      state.selected = recipe;
      renderPrimary({ recipe, score });
      renderDetails(recipe);
    });

    card.append(title, summary, button);
    return card;
  });

  els.recipeList.replaceChildren(...cards);
}

async function renderDetails(recipe) {
  const details = await getRecipeDetails(recipe.id);
  const fullRecipe = { ...recipe, ...details };

  els.details.hidden = false;
  els.detailsName.textContent = fullRecipe.name;
  els.detailsLink.href = fullRecipe.url;
    els.detailsLink.textContent = fullRecipe.source || "Provenance";

  const ingredientItems = (fullRecipe.ingredients.length ? fullRecipe.ingredients : ["No ingredients listed"]).map((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    return li;
  });

  const statNodes = [];
  [
    ["Protein", formatMacro(fullRecipe.macros.protein)],
    ["Fat", formatMacro(fullRecipe.macros.fat)],
    ["Carbs", formatMacro(fullRecipe.macros.carbs)],
    ["Calories", `${formatNumber(fullRecipe.macros.calories, 0)} kcal`],
    ["Servings", formatNumber(fullRecipe.servings, 1)],
    ["Recipe weight", `${formatNumber(fullRecipe.weight, 0)}g`],
    ["Recipe calories", `${formatNumber(fullRecipe.totalCalories, 0)} kcal`],
  ].forEach(([label, value]) => {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    statNodes.push(dt, dd);
  });

  const labels = fullRecipe.labels.length ? fullRecipe.labels : ["Unlabeled"];
  const labelNodes = labels.map((label) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = label;
    return chip;
  });

  els.ingredientList.replaceChildren(...ingredientItems);
  els.statsList.replaceChildren(...statNodes);
  els.labelList.replaceChildren(...labelNodes);
  els.details.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function getRecipeDetails(id) {
  if (!state.details) {
    els.status.textContent = "Opening the ledger";
    const response = await fetch(DETAILS_URL);
    if (!response.ok) {
      throw new Error(`Unable to load ${DETAILS_URL}`);
    }
    state.details = await response.json();
    els.status.textContent = `${state.recipes.length.toLocaleString()} constraints indexed`;
  }
  return state.details[String(id)] || {};
}

function macroTiles(macros) {
  return MACRO_KEYS.map((key) => {
    const tile = document.createElement("div");
    tile.className = "macro-tile";
    const label = document.createElement("span");
    label.textContent = `${DISPLAY_LABELS[key]} / 100g`;
    const value = document.createElement("strong");
    value.textContent = key === "calories" ? `${formatNumber(macros[key], 0)} kcal` : formatMacro(macros[key]);
    tile.append(label, value);
    return tile;
  });
}

function updateOutputs() {
  MACRO_KEYS.forEach((key) => {
    outputs[key].textContent =
      key === "calories" ? `${formatNumber(state.targets[key], 0)} kcal` : formatMacro(state.targets[key]);
  });
}

function compactMeta(recipe) {
  const bits = [recipe.source, recipe.cuisine, recipe.meal, recipe.dish].filter(Boolean);
  return bits.slice(0, 3).join(" · ");
}

function verdictFor(fit, id) {
  if (fit >= 98) return "Clean compliance. Suspiciously edible";
  if (fit >= 92) return VERDICTS[id % VERDICTS.length];
  if (fit >= 82) return "Within tolerance. Emotionally distant";
  return "The kitchen refuses perfection today";
}

function formatMacro(value) {
  return `${formatNumber(value, 1)}g`;
}

function formatNumber(value, digits) {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function squared(value) {
  return value * value;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
