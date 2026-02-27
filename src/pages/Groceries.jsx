import { useState } from "react";
import Header from "../components/Header.jsx";
import Footer from "../components/Footer.jsx";
import Divider from "../components/Divider.jsx";
import { ChefHat, Flame, Snowflake, Minus, Ban, Refrigerator, Utensils, ShoppingCart, Loader, RefreshCw } from "lucide-react";

const DIETARY_RESTRICTIONS = [
  { id: "vegetarian", label: "vegetarian" },
  { id: "vegan", label: "vegan" },
  { id: "gluten-free", label: "gluten-free" },
  { id: "dairy-free", label: "dairy-free" },
  { id: "keto", label: "keto" },
  { id: "low-carb", label: "low-carb" },
  { id: "zero-sugar", label: "zero sugar" },
  { id: "paleo", label: "paleo" },
  { id: "halal", label: "halal" },
  { id: "kosher", label: "kosher" },
  { id: "nut-free", label: "nut-free" },
];

function MealCard({ number, meal, onReroll, rerolling }) {
  return (
    <div className="bg-white rounded-2xl shadow-xl p-6 flex flex-col gap-3 flex-1">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-blue-600 uppercase tracking-widest">meal {number}</div>
        <button
          onClick={onReroll}
          disabled={rerolling}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 border border-blue-300 bg-blue-50 hover:bg-blue-100 active:bg-blue-200 disabled:opacity-40 px-3 py-1.5 rounded-xl transition-colors"
        >
          {rerolling
            ? <Loader size={13} className="animate-spin" />
            : <RefreshCw size={13} />}
          {rerolling ? "rerolling..." : "reroll"}
        </button>
      </div>
      <h2 className="text-xl font-bold text-gray-800 leading-tight">{meal.title}</h2>
      <p className="text-gray-500 text-sm italic">{meal.description}</p>
      <div>
        <div className="text-sm font-semibold text-gray-600 mb-2">how to make it</div>
        <ul className="flex flex-col gap-1.5">
          {(Array.isArray(meal.steps) ? meal.steps : [meal.steps]).map((step, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
              <span className="mt-1.5 w-2 h-2 rounded-full bg-gray-300 flex-shrink-0" />
              {step}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Groceries() {
  const [spiceTolerance, setSpiceTolerance] = useState("no preference");
  const [extraNotes, setExtraNotes] = useState("");
  const [excluded, setExcluded] = useState("");
  const [mustInclude, setMustInclude] = useState("");
  const [maxCalories, setMaxCalories] = useState("");
  const [servings, setServings] = useState("");
  const [dietaryRestrictions, setDietaryRestrictions] = useState([]);
  const [mealPlan, setMealPlan] = useState(null);
  const [loading, setLoading] = useState(false);
  const [rerolling, setRerolling] = useState(null); // "meal1" | "meal2" | null
  const [error, setError] = useState("");

  const buildPreferences = () => [
    spiceTolerance && spiceTolerance !== "no preference" && `spice level: ${spiceTolerance}`,
    dietaryRestrictions.length > 0 && `dietary restrictions: ${dietaryRestrictions.join(", ")}`,
    mustInclude && mustInclude.trim() && `must use these ingredients: ${mustInclude.trim()}`,
    maxCalories && `maximum calories per serving: ${maxCalories} kcal`,
    servings && `number of servings: ${servings}`,
    extraNotes && `additional notes: ${extraNotes}`,
  ].filter(Boolean).join(", ");

  const handleReroll = async (target) => {
    if (!mealPlan) return;
    setRerolling(target);
    setError("");
    const keepMeal = target === "meal1" ? mealPlan.meal2 : mealPlan.meal1;
    try {
      const res = await fetch("/api/recipe-reroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rerollTarget: target, keepMeal, preferences: buildPreferences(), excluded }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reroll.");
      setMealPlan((prev) => ({
        ...prev,
        [target]: data.newMeal,
        groceryList: data.groceryList,
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setRerolling(null);
    }
  };

  const handleGenerate = async () => {
    setLoading(true);
    setMealPlan(null);
    setError("");
    try {
      const res = await fetch("/api/recipe-generator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spiceTolerance, dietaryRestrictions, mustInclude, maxCalories, servings, extraNotes, excluded }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate meal plan.");
      setMealPlan(data.mealPlan);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Header />
      <div className="beyond-red-line page-content">
        <Divider rotate={0} text="meal planner" />

        {/* Controls card */}
        <div className="bg-white rounded-2xl shadow-xl w-full p-6 md:p-[2vw] flex flex-col gap-6">

          {/* Spice tolerance */}
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-2">spice tolerance</label>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setSpiceTolerance("no spice")}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                  spiceTolerance === "no spice"
                    ? "bg-blue-200 text-blue-800 border-blue-300"
                    : "bg-white text-gray-600 border-gray-300 hover:border-blue-300"
                }`}
              >
                <Snowflake size={15} />
                no spice
              </button>
              <button
                onClick={() => setSpiceTolerance("no preference")}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                  spiceTolerance === "no preference"
                    ? "bg-gray-200 text-gray-800 border-gray-400"
                    : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                }`}
              >
                <Minus size={15} />
                no preference
              </button>
              <button
                onClick={() => setSpiceTolerance("spicy")}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                  spiceTolerance === "spicy"
                    ? "bg-orange-500 text-white border-orange-500"
                    : "bg-white text-gray-600 border-gray-300 hover:border-orange-400"
                }`}
              >
                <Flame size={15} />
                spicy
              </button>
            </div>
          </div>

          {/* Dietary restrictions */}
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-2">dietary restrictions <span className="font-light italic text-gray-400">(select all that apply)</span></label>
            <div className="flex flex-wrap gap-2">
              {DIETARY_RESTRICTIONS.map(({ id, label }) => {
                const active = dietaryRestrictions.includes(id);
                return (
                  <button
                    key={id}
                    onClick={() =>
                      setDietaryRestrictions((prev) =>
                        active ? prev.filter((r) => r !== id) : [...prev, id]
                      )
                    }
                    className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
                      active
                        ? "bg-purple-600 text-white border-purple-600"
                        : "bg-white text-gray-600 border-gray-300 hover:border-purple-400"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Calories & servings */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label className="block text-sm font-semibold text-gray-600 mb-1">
                max calories per serving <span className="font-light italic text-gray-400">(optional)</span>
              </label>
              <input
                type="number"
                min="0"
                value={maxCalories}
                onChange={(e) => setMaxCalories(e.target.value)}
                placeholder="e.g. 500"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-semibold text-gray-600 mb-1 inline-flex items-center gap-1.5">
                <Utensils size={13} />
                number of servings <span className="font-light italic text-gray-400">(optional)</span>
              </label>
              <input
                type="number"
                min="1"
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                placeholder="e.g. 4"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition"
              />
            </div>
          </div>

          {/* Fridge ingredients */}
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-1 inline-flex items-center gap-1.5">
              <Refrigerator size={13} className="text-blue-500" />
              already in the fridge?
              <span className="font-light italic text-gray-400">(optional)</span>
            </label>
            <p className="text-xs text-gray-400 mb-2">these ingredients must be used in the recipe</p>
            <input
              type="text"
              value={mustInclude}
              onChange={(e) => setMustInclude(e.target.value)}
              placeholder="e.g. chicken breast, lemon, garlic..."
              className="w-full border border-blue-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent transition"
            />
          </div>

          {/* Excluded ingredients */}
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-1 inline-flex items-center gap-1.5">
              <Ban size={13} className="text-red-500" />
              picky eater? exclude ingredients
              <span className="font-light italic text-gray-400">(optional)</span>
            </label>
            <p className="text-xs text-gray-400 mb-2">these ingredients will never appear in the recipe</p>
            <input
              type="text"
              value={excluded}
              onChange={(e) => setExcluded(e.target.value)}
              placeholder="e.g. mushrooms, cilantro, nuts, shellfish..."
              className="w-full border border-red-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-transparent transition"
            />
          </div>

          {/* Extra notes */}
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-2">
              anything else? <span className="font-light italic text-gray-400">(optional)</span>
            </label>
            <input
              type="text"
              value={extraNotes}
              onChange={(e) => setExtraNotes(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && handleGenerate()}
              placeholder="e.g. vegetarian, uses chicken, under 30 minutes..."
              className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition"
            />
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="self-start inline-flex items-center gap-2 bg-blue-700 hover:bg-blue-800 active:bg-blue-900 disabled:opacity-60 text-white font-semibold px-6 py-2.5 rounded-xl shadow transition-colors"
          >
            {loading ? <Loader size={16} className="animate-spin" /> : <ChefHat size={16} />}
            {loading ? "planning..." : "plan my meals"}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl px-6 py-4 text-sm">
            {error}
          </div>
        )}

        {/* Meal plan output */}
        {mealPlan && (
          <>
            <Divider rotate={0} text="your meal plan" />
            <div className="flex flex-col md:flex-row gap-4 w-full">
              <MealCard number={1} meal={mealPlan.meal1} onReroll={() => handleReroll("meal1")} rerolling={rerolling === "meal1"} />
              <MealCard number={2} meal={mealPlan.meal2} onReroll={() => handleReroll("meal2")} rerolling={rerolling === "meal2"} />
            </div>
            <Divider rotate={0} text="shared grocery list" />
            <div className="bg-white rounded-2xl shadow-xl w-full p-6 md:p-[2vw] mb-6">
              <div className="flex items-center gap-2 mb-4 text-gray-700 font-semibold">
                <ShoppingCart size={18} />
                everything you need for both meals
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
                {mealPlan.groceryList.map((item, i) => {
                  const match = item.match(/^(.+?)\s*(\(.*\))$/);
                  const name = match ? match[1].trim() : item;
                  const qty = match ? match[2] : null;
                  return (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                      <span>
                        {name}
                        {qty && <span className="ml-1 text-gray-400 font-light">{qty}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </div>
      <Footer />
    </>
  );
}

export default Groceries;

