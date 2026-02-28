import { useState, useEffect } from "react";
import Header from "../components/Header.jsx";
import Footer from "../components/Footer.jsx";
import Divider from "../components/Divider.jsx";
import {
  ChefHat,
  Flame,
  Snowflake,
  Minus,
  Ban,
  Refrigerator,
  Trophy,
  Swords,
  ShoppingCart,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Check,
} from "lucide-react";

const BATTLE_FLAVOR = [
  "sharpening the knives...",
  "preparing mirepoix...",
  "chopping onions...",
  "washing hands...",
  "seasoning to taste...",
  "gathering contestants...",
  "firing up the stove...",
  "consulting the cookbook...",
  "reducing the sauce...",
];

const GROCERY_FLAVOR = [
  "scanning the aisles...",
  "comparing recipes...",
  "preheating oven...",
  "writing the list...",
  "checking the pantry...",
  "counting servings...",
  "picking the freshest produce...",
  "estimating portion sizes...",
];

function LoadingOverlay({ visible, flavor, icon: Icon }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setIdx(0);
    const t = setInterval(() => setIdx((i) => (i + 1) % flavor.length), 1800);
    return () => clearInterval(t);
  }, [visible, flavor]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.35)" }}>
      <style>{`
        @keyframes bar-slide {
          0%   { left: -50%; width: 50%; }
          50%  { left: 35%; width: 40%; }
          100% { left: 100%; width: 50%; }
        }
        .loading-bar-inner {
          animation: bar-slide 1.5s ease-in-out infinite;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div className="bg-white rounded-2xl shadow-2xl px-6 py-7 sm:px-10 sm:py-8 flex flex-col items-center gap-5 w-[88vw] max-w-sm sm:w-72">
        <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
          <Icon size={24} className="text-blue-600" />
        </div>
        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden relative">
          <div className="loading-bar-inner absolute top-0 h-full bg-blue-500 rounded-full" />
        </div>
        <p
          key={idx}
          className="text-sm text-gray-500 text-center"
          style={{ animation: "fadeIn 0.4s ease" }}
        >
          {flavor[idx]}
        </p>
      </div>
    </div>
  );
}

const DIETARY_RESTRICTIONS = [
  { id: "vegetarian", label: "vegetarian" },
  { id: "vegan", label: "vegan" },
  { id: "gluten-free", label: "gluten-free" },
  { id: "dairy-free", label: "dairy-free" },
  { id: "keto", label: "keto" },
  { id: "zero-sugar", label: "zero sugar" },
  { id: "paleo", label: "paleo" },
  { id: "halal", label: "halal" },
  { id: "kosher", label: "kosher" },
  { id: "nut-free", label: "nut-free" },
];

const PRIMARY_FLAVORS = [
  { id: "sweet", label: "sweet", color: "bg-pink-100 text-pink-800 border-pink-300" },
  { id: "salty", label: "salty", color: "bg-blue-100 text-blue-800 border-blue-300" },
  { id: "sour", label: "sour", color: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  { id: "bitter", label: "bitter", color: "bg-green-100 text-green-800 border-green-300" },
  { id: "umami", label: "umami", color: "bg-amber-100 text-amber-800 border-amber-300" },
];

const SECONDARY_FLAVORS = [
  { id: "herbaceous", label: "herbaceous" },
  { id: "smoky", label: "smoky" },
  { id: "fresh", label: "fresh" },
  { id: "bold", label: "bold" },
  { id: "light", label: "light" },
  { id: "hearty", label: "hearty" },
  { id: "comfort food", label: "comfort food" },
  { id: "tangy", label: "tangy" },
  { id: "earthy", label: "earthy" },
  { id: "bright", label: "bright" },
  { id: "delicate", label: "delicate" },
  { id: "rich", label: "rich" },
  { id: "healthy", label: "healthy" },
  { id: "indulgent", label: "indulgent" },
];

const ROUND_LABELS = {
  1: { name: "round of 16", subtitle: "8 matchups — pick the dish you'd rather eat" },
  2: { name: "quarterfinals", subtitle: "4 matchups — pick the dish you'd rather eat" },
  3: { name: "semifinals", subtitle: "2 matchups — pick your 2 winners and create a grocery list" },
};

function pairMatchups(arr) {
  const pairs = [];
  for (let i = 0; i + 1 < arr.length; i += 2) {
    pairs.push([arr[i], arr[i + 1]]);
  }
  return pairs;
}

function RoundProgress({ currentRound }) {
  const steps = [
    { label: "grp", round: 1 },
    { label: "qtr", round: 2 },
    { label: "semi", round: 3 },
    { label: "🏆", round: 4 },
  ];
  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((s, i) => (
        <div key={s.round} className="flex items-center gap-2">
          <div
            className={`text-xs font-bold px-3 py-1 rounded-full border transition-colors ${
              s.round < currentRound
                ? "bg-blue-600 text-white border-blue-600"
                : s.round === currentRound
                ? "bg-blue-100 text-blue-700 border-blue-400"
                : "bg-white text-gray-300 border-gray-200"
            }`}
          >
            {s.label}
          </div>
          {i < steps.length - 1 && (
            <div className={`w-6 h-px ${s.round < currentRound ? "bg-blue-400" : "bg-gray-200"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function MatchupCard({ matchup, matchupIndex, pick, onPick, animating }) {
  const [a, b] = matchup;

  const aStyle = animating === 'a'
    ? { animation: 'battle-winner-bulge 0.7s ease both' }
    : {};

  const bStyle = animating === 'b'
    ? { animation: 'battle-winner-bulge 0.7s ease both' }
    : {};

  return (
    <div className="bg-white rounded-2xl shadow-lg p-4 flex flex-col gap-3">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-widest text-center">
        matchup {matchupIndex + 1}
      </div>
      <div className="flex flex-col sm:flex-row gap-3 items-stretch">
        {/* Recipe A */}
        <button
          onClick={() => onPick(matchupIndex, a)}
          style={aStyle}
          className={`flex-1 text-left rounded-xl p-3 sm:p-4 border-2 transition-colors ${
            pick === a
              ? "border-blue-500 bg-blue-50 shadow-md"
              : "border-gray-200 bg-gray-50 hover:border-blue-300 hover:bg-blue-50/40"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-bold text-gray-800 text-sm leading-tight lowercase">{a.title}</h3>
            {pick === a && (
              <span className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center">
                <Check size={12} className="text-white" />
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">{a.description}</p>
        </button>

        {/* VS divider */}
        <div className="flex sm:flex-col items-center justify-center gap-2 py-1 sm:py-0">
          <div className="flex-1 sm:h-full sm:w-px w-full h-px bg-gray-200" />
          <span className="text-xs font-black text-gray-400 tracking-widest px-2 sm:px-0 sm:py-2">VS</span>
          <div className="flex-1 sm:h-full sm:w-px w-full h-px bg-gray-200" />
        </div>

        {/* Recipe B */}
        <button
          onClick={() => onPick(matchupIndex, b)}
          style={bStyle}
          className={`flex-1 text-left rounded-xl p-3 sm:p-4 border-2 transition-colors ${
            pick === b
              ? "border-blue-500 bg-blue-50 shadow-md"
              : "border-gray-200 bg-gray-50 hover:border-blue-300 hover:bg-blue-50/40"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-bold text-gray-800 text-sm leading-tight lowercase">{b.title}</h3>
            {pick === b && (
              <span className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center">
                <Check size={12} className="text-white" />
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">{b.description}</p>
        </button>
      </div>
    </div>
  );
}

function GroceryBattle() {
  const [phase, setPhase] = useState("setup"); // setup | bracket | results
  const [setupStep, setSetupStep] = useState(0); // highest step reached
  const [expandedSteps, setExpandedSteps] = useState(new Set([0])); // which steps are open
  const [loading, setLoading] = useState(false);
  const [animatingSet, setAnimatingSet] = useState(new Set());
  const [roundVisible, setRoundVisible] = useState(true);

  const toggleExpand = (step) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  };

  const advanceSetup = (nextStep) => {
    setSetupStep((s) => Math.max(s, nextStep));
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      next.delete(nextStep - 1);
      next.add(nextStep);
      return next;
    });
  };
  const [generatingList, setGeneratingList] = useState(false);
  const [error, setError] = useState("");

  // Preferences
  const [spiceTolerance, setSpiceTolerance] = useState("no preference");
  const [dietaryRestrictions, setDietaryRestrictions] = useState([]);
  const [mustInclude, setMustInclude] = useState("");
  const [excluded, setExcluded] = useState("");
  const [macros, setMacros] = useState({ fat: "none", carbs: "none", protein: "none", calories: "none" });
  const [primaryFlavors, setPrimaryFlavors] = useState([]);
  const [secondaryFlavors, setSecondaryFlavors] = useState([]);
  const [creativity, setCreativity] = useState("balanced");
  const [extraNotes, setExtraNotes] = useState("");

  // Bracket
  const [matchups, setMatchups] = useState([]); // [[recipeA, recipeB], ...]
  const [picks, setPicks] = useState({}); // { matchupIndex: recipe }
  const [bracketRound, setBracketRound] = useState(1);

  // Results
  const [mealPlan, setMealPlan] = useState(null);

  const buildPreferences = () =>
    [
      spiceTolerance && spiceTolerance !== "no preference" && `spice level: ${spiceTolerance}`,
      dietaryRestrictions.length > 0 && `dietary restrictions: ${dietaryRestrictions.join(", ")}`,
      mustInclude && mustInclude.trim() && `must use these ingredients: ${mustInclude.trim()}`,
      macros.fat !== "none" && `${macros.fat} fat`,
      macros.carbs !== "none" && `${macros.carbs} carb`,
      macros.protein !== "none" && `${macros.protein} protein`,
      macros.calories !== "none" && `${macros.calories} calorie`,
      extraNotes && `additional notes: ${extraNotes}`,
    ]
      .filter(Boolean)
      .join(", ");

  const handleGenerateBattle = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/battle-generator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spiceTolerance,
          dietaryRestrictions,
          mustInclude,
          macros,
          primaryFlavors,
          secondaryFlavors,
          creativity,
          extraNotes,
          excluded,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate battle.");
      setMatchups(pairMatchups(data.recipes));
      setPicks({});
      setBracketRound(1);
      setPhase("bracket");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePick = (matchupIndex, recipe) => {
    setPicks((prev) => ({ ...prev, [matchupIndex]: recipe }));
  };

  const allPicked = matchups.length > 0 && matchups.every((_, i) => picks[i] !== undefined);

  const handleAdvanceRound = async () => {
    const winners = matchups.map((_, i) => picks[i]);
    if (bracketRound === 3) {
      // The 2 winners are the champions — generate full recipes + grocery list
      setGeneratingList(true);
      setError("");
      try {
        const res = await fetch("/api/battle-grocery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            meal1: winners[0],
            meal2: winners[1],
            preferences: buildPreferences(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to generate grocery list.");
        setMealPlan(data);
        setPhase("results");
      } catch (err) {
        setError(err.message);
      } finally {
        setGeneratingList(false);
      }
    } else {
      setMatchups(pairMatchups(winners));
      setPicks({});
      setBracketRound((r) => r + 1);
    }
  };

  const handleReset = () => {
    setPhase("setup");
    setSetupStep(0);
    setExpandedSteps(new Set([0]));
    setMatchups([]);
    setPicks({});
    setBracketRound(1);
    setMealPlan(null);
    setError("");
    // reset all preferences
    setSpiceTolerance("no preference");
    setDietaryRestrictions([]);
    setMustInclude("");
    setExcluded("");
    setMacros({ fat: "none", carbs: "none", protein: "none", calories: "none" });
    setPrimaryFlavors([]);
    setSecondaryFlavors([]);
    setCreativity("balanced");
    setExtraNotes("");
  };

  const ANIM_STAGGER = 150; // ms between each row starting
  const ANIM_DURATION = 700; // ms per animation

  const handleAdvanceClick = () => {
    const n = matchups.length;
    matchups.forEach((_, i) => {
      // Start this row's animation
      setTimeout(() => {
        setAnimatingSet((prev) => new Set([...prev, i]));
      }, i * ANIM_STAGGER);
      // End this row's animation
      setTimeout(() => {
        setAnimatingSet((prev) => {
          const next = new Set(prev);
          next.delete(i);
          return next;
        });
      }, i * ANIM_STAGGER + ANIM_DURATION);
    });

    // After the last animation finishes, do the round transition
    const totalDuration = (n - 1) * ANIM_STAGGER + ANIM_DURATION + 20;
    setTimeout(() => {
      setRoundVisible(false);
      setTimeout(() => {
        handleAdvanceRound();
        setRoundVisible(true);
      }, 350);
    }, totalDuration);
  };

  const AdvanceButton = () => (
    <button
      onClick={handleAdvanceClick}
      disabled={!allPicked || generatingList || animatingSet.size > 0}
      className="inline-flex items-center justify-center gap-2 w-full sm:w-auto bg-blue-700 hover:bg-blue-800 active:bg-blue-900 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-5 py-2.5 rounded-xl shadow transition-colors text-sm"
    >
      {bracketRound === 3 ? (
        <>
          <Trophy size={15} />
          crown winners & get grocery list
        </>
      ) : (
        <>
          advance to {ROUND_LABELS[bracketRound + 1]?.name ?? "next round"}
          <ChevronRight size={15} />
        </>
      )}
    </button>
  );

  return (
    <>
      <LoadingOverlay visible={loading} flavor={BATTLE_FLAVOR} icon={ChefHat} />
      <LoadingOverlay visible={generatingList} flavor={GROCERY_FLAVOR} icon={ShoppingCart} />
      <Header />
      <div className="beyond-red-line page-content">

        {/* ── INTRO ── */}
        {phase === "setup" && (
          <div className="bg-white rounded-2xl shadow-xl w-full p-4 sm:p-6 md:p-[2vw] flex flex-col gap-3">
            <h2 className="text-xl font-bold text-gray-800">grocery battle</h2>
            <p className="text-sm text-gray-500 leading-relaxed">
              all too often recipes call for a few sprigs of cilantro, one cup of cream, or half of one lemon.
              
            </p>
            <p className="text-sm text-gray-500 leading-relaxed">
            but you cannot buy just half a lemon, or cream by the cup at the grocery store, leaving the rest to sit in the fridge until it goes bad and is thrown away.
            </p>
            <p className="text-sm text-gray-600 leading-relaxed">
              grocery battle fixes this by finding <span className="font-semibold text-gray-800">tonally distinct dishes that draw from the same pool of ingredients</span>
              , so that you can plan multiple dishes in a single grocery run with nothing left behind.
              describe your preferences, pick your way through a <span className="font-semibold text-gray-800">16-recipe bracket</span>,
              and the 2 dishes that make it to the finals become your meal plan along with a single, waste-free grocery list.
            </p>
          </div>
        )}

        {phase === "setup" && <Divider rotate={0} text="meal preferences" />}

        {/* ── SETUP PHASE ── */}
        {phase === "setup" && (
          <div className="w-full">
            {/* Vertical step spine */}
            {[
              { idx: 0, label: "diet", title: "dietary restrictions" },
              { idx: 1, label: "ingredients", title: "ingredients" },
              { idx: 2, label: "macros", title: "macros" },
              { idx: 3, label: "flavor", title: "flavor, spice & creativity" },
              { idx: 4, label: "notes", title: "anything else?" },
            ].map(({ idx, label }) => {
              if (setupStep < idx) return null;
              const isExpanded = expandedSteps.has(idx);
              const isDone = setupStep > idx;
              const isLastReached = idx === setupStep;
              const showLine = idx < 4 && setupStep > idx;
              const showPendingLine = idx < 4 && isLastReached;

              return (
                <div key={idx} className="flex gap-0 sm:gap-4 items-stretch">
                  {/* ── Left spine ── */}
                  <div className="hidden sm:flex flex-col items-center flex-shrink-0 w-7">
                    <button
                      onClick={() => toggleExpand(idx)}
                      className={`w-7 h-7 mt-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                        isDone
                          ? "bg-blue-600 border-blue-600 hover:bg-blue-700"
                          : isLastReached
                          ? "bg-white border-blue-500"
                          : "bg-white border-gray-200"
                      }`}
                    >
                      {isDone
                        ? <Check size={13} className="text-white" />
                        : <span className={`text-xs font-bold ${ isLastReached ? "text-blue-600" : "text-gray-400" }`}>{idx + 1}</span>
                      }
                    </button>
                    {(showLine || showPendingLine) && (
                      <div className={`w-0.5 flex-1 mt-1 ${ showLine ? "bg-blue-300" : "bg-gray-200" }`} />
                    )}
                  </div>

                  {/* ── Right card ── */}
                  <div className="flex-1 min-w-0 pb-3">
                    {isExpanded ? (
                      /* EXPANDED FORM */
                      <div className="bg-white rounded-2xl shadow-xl w-full p-4 sm:p-5 md:p-6 flex flex-col gap-5 mt-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xs font-semibold text-blue-600 uppercase tracking-widest mb-1">step {idx + 1} of 5</div>
                            <h2 className="text-lg font-bold text-gray-800">
                              {idx === 0 && "dietary restrictions"}
                              {idx === 1 && "ingredients"}
                              {idx === 2 && "macros"}
                              {idx === 3 && "flavor, spice & creativity"}
                              {idx === 4 && "anything else?"}
                            </h2>
                            <p className="text-sm text-gray-500 mt-0.5">
                              {idx === 0 && "select any to apply to all 16 recipes"}
                              {idx === 1 && "choose must-have and must-not-have ingredients to shape the battle"}
                              {idx === 2 && "set your macro targets for all 16 dishes"}
                              {idx === 3 && "define the taste profile, heat level, and how adventurous the AI should be"}
                              {idx === 4 && "extra context to help shape the 16 contestants"}
                            </p>
                          </div>
                          {isDone && (
                            <button
                              onClick={() => toggleExpand(idx)}
                              className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors mt-0.5"
                              aria-label="collapse"
                            >
                              <ChevronUp size={18} />
                            </button>
                          )}
                        </div>

                        {/* Step 0 content */}
                        {idx === 0 && (
                          <div className="flex flex-wrap gap-2">
                            {DIETARY_RESTRICTIONS.map(({ id, label: lbl }) => {
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
                                  {lbl}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Step 1 content */}
                        {idx === 1 && (
                          <>
                            <div>
                              <label className="inline-flex flex-wrap text-sm font-semibold text-gray-600 mb-1 items-center gap-1.5">
                                <Refrigerator size={13} className="text-blue-500" />
                                already in the fridge?
                                <span className="font-light italic text-gray-400">(optional)</span>
                              </label>
                              <p className="text-xs text-gray-400 mb-2">these ingredients will be included in ALL recipes, though other items may be included as well</p>
                              <input
                                type="text"
                                value={mustInclude}
                                onChange={(e) => setMustInclude(e.target.value)}
                                placeholder="e.g. chicken breast, lemon, garlic..."
                                className="w-full border border-blue-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent transition"
                              />
                            </div>
                            <div>
                              <label className="inline-flex flex-wrap text-sm font-semibold text-gray-600 mb-1 items-center gap-1.5">
                                <Ban size={13} className="text-red-500" />
                                not quite your tempo? exclude ingredients
                                <span className="font-light italic text-gray-400">(optional)</span>
                              </label>
                              <p className="text-xs text-gray-400 mb-2">NONE of the 16 dishes will contain these</p>
                              <input
                                type="text"
                                value={excluded}
                                onChange={(e) => setExcluded(e.target.value)}
                                placeholder="e.g. mushrooms, cilantro, nuts, shellfish..."
                                className="w-full border border-red-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-transparent transition"
                              />
                            </div>
                          </>
                        )}

                        {/* Step 2 content */}
                        {idx === 2 && (
                          <>
                            {[
                              { key: "fat", label: "fat" },
                              { key: "carbs", label: "carbs" },
                              { key: "protein", label: "protein" },
                              { key: "calories", label: "calories" },
                            ].map(({ key, label }) => (
                              <div key={key}>
                                <label className="block text-sm font-semibold text-gray-600 mb-2">{label}</label>
                                <div className="flex gap-2 sm:gap-6 md:gap-10 w-full">
                                  {["low", "none", "high"].map((level) => (
                                    <button
                                      key={level}
                                      onClick={() => setMacros((prev) => ({ ...prev, [key]: level }))}
                                      className={`flex-1 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
                                        macros[key] === level
                                          ? level === "low"
                                            ? "bg-sky-100 text-sky-800 border-sky-300"
                                            : level === "high"
                                            ? "bg-green-100 text-green-800 border-green-300"
                                            : "bg-gray-200 text-gray-700 border-gray-400"
                                          : "bg-white text-gray-500 border-gray-200 hover:border-gray-400"
                                      }`}
                                    >
                                      <span className="inline-flex items-center justify-center gap-1.5">
                                        {level === "low" && <ChevronDown size={14} />}
                                        {level === "none" && <Minus size={14} />}
                                        {level === "high" && <ChevronUp size={14} />}
                                        {level === "none" ? (
                          <>
                            <span className="sm:hidden">any</span>
                            <span className="hidden sm:inline">no preference</span>
                          </>
                        ) : level}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </>
                        )}

                        {/* Step 3 content — Flavor, Spice & Creativity */}
                        {idx === 3 && (
                          <>
                            <div>
                              <label className="block text-sm font-semibold text-gray-600 mb-2">primary flavor profiles <span className="font-light italic text-gray-400">(select all that apply)</span></label>
                              <div className="flex flex-wrap gap-2">
                                {PRIMARY_FLAVORS.map(({ id, label: lbl, color }) => {
                                  const active = primaryFlavors.includes(id);
                                  return (
                                    <button
                                      key={id}
                                      onClick={() => setPrimaryFlavors((prev) => active ? prev.filter((f) => f !== id) : [...prev, id])}
                                      className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${active ? color : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"}`}
                                    >
                                      {lbl}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            <div>
                              <label className="block text-sm font-semibold text-gray-600 mb-2">secondary vibes <span className="font-light italic text-gray-400">(select all that apply)</span></label>
                              <div className="flex flex-wrap gap-2">
                                {SECONDARY_FLAVORS.map(({ id, label: lbl }) => {
                                  const active = secondaryFlavors.includes(id);
                                  return (
                                    <button
                                      key={id}
                                      onClick={() => setSecondaryFlavors((prev) => active ? prev.filter((f) => f !== id) : [...prev, id])}
                                      className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
                                        active
                                          ? "bg-teal-600 text-white border-teal-600"
                                          : "bg-white text-gray-600 border-gray-300 hover:border-teal-400"
                                      }`}
                                    >
                                      {lbl}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
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
                                  <Snowflake size={15} /> no spice
                                </button>
                                <button
                                  onClick={() => setSpiceTolerance("no preference")}
                                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                                    spiceTolerance === "no preference"
                                      ? "bg-gray-200 text-gray-800 border-gray-400"
                                      : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                                  }`}
                                >
                                  <Minus size={15} /> no preference
                                </button>
                                <button
                                  onClick={() => setSpiceTolerance("spicy")}
                                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                                    spiceTolerance === "spicy"
                                      ? "bg-orange-500 text-white border-orange-500"
                                      : "bg-white text-gray-600 border-gray-300 hover:border-orange-400"
                                  }`}
                                >
                                  <Flame size={15} /> spicy
                                </button>
                              </div>
                            </div>
                            <div>
                              <label className="block text-sm font-semibold text-gray-600 mb-1">creativity temperature</label>
                              <p className="text-xs text-gray-400 mb-3">how adventurous should the AI be when building dishes beyond your listed ingredients?</p>
                              <div className="flex flex-col gap-2">
                                {[
                                  { val: "strict", title: "strict", desc: "stick closely to your listed ingredients — no surprises" },
                                  { val: "balanced", title: "balanced", desc: "mostly your ingredients, with thoughtful additions to complete the dish" },
                                  { val: "creative", title: "creative", desc: "AI takes the wheel — expect unexpected flavour combinations and bold choices" },
                                ].map(({ val, title, desc }) => (
                                  <button
                                    key={val}
                                    onClick={() => setCreativity(val)}
                                    className={`text-left rounded-xl px-4 py-3 border-2 transition-all ${
                                      creativity === val
                                        ? "border-blue-500 bg-blue-50"
                                        : "border-gray-200 bg-white hover:border-blue-300"
                                    }`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${
                                        creativity === val ? "bg-blue-500 border-blue-500" : "border-gray-400"
                                      }`} />
                                      <span className="text-sm font-semibold text-gray-800">{title}</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1 pl-5">{desc}</p>
                                  </button>
                                ))}
                              </div>
                            </div>
                          </>
                        )}

                        {/* Step 4 content — Notes */}
                        {idx === 4 && (
                          <>
                            <div>
                              <label className="block text-sm font-semibold text-gray-600 mb-2">
                                additional notes <span className="font-light italic text-gray-400">(optional)</span>
                              </label>
                              <input
                                type="text"
                                value={extraNotes}
                                onChange={(e) => setExtraNotes(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && !loading && handleGenerateBattle()}
                                placeholder="e.g. quick weeknight meals, comfort food vibes, summer bbq..."
                                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition text-ellipsis"
                              />
                            </div>
                            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-700 leading-relaxed">
                              <span className="font-semibold">ready to battle?</span> we'll cook up 16 unique dishes and pit them against each other in a 3-round bracket. the last 2 standing become your meal plan.
                            </div>
                            {error && (
                              <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>
                            )}
                          </>
                        )}

                        {/* Continue / Launch button */}
                        <div className="flex justify-end">
                          {idx < 4 ? (
                            <button
                              onClick={() => advanceSetup(idx + 1)}
                              className="inline-flex items-center gap-1.5 text-sm font-semibold bg-blue-700 hover:bg-blue-800 text-white px-5 py-2 rounded-xl shadow transition-colors"
                            >
                              continue <ChevronRight size={15} />
                            </button>
                          ) : (
                            <button
                              onClick={handleGenerateBattle}
                              disabled={loading}
                              className="inline-flex items-center gap-2 bg-blue-700 hover:bg-blue-800 active:bg-blue-900 disabled:opacity-60 text-white font-semibold px-6 py-2.5 rounded-xl shadow transition-colors"
                            >
                              <Swords size={16} />
                              generate bracket
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      /* COLLAPSED SUMMARY — clickable to re-expand */
                      <button
                        onClick={() => toggleExpand(idx)}
                        className="w-full text-left bg-white rounded-2xl shadow border border-gray-100 px-5 py-3.5 flex items-start justify-between gap-4 hover:border-blue-200 hover:shadow-md transition-all mt-2"
                      >
                        <div className="flex flex-col gap-1.5 min-w-0">
                          <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                            {label}
                          </span>

                          {/* Summary for diet */}
                          {idx === 0 && (
                            dietaryRestrictions.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {dietaryRestrictions.map((r) => (
                                  <span key={r} className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-lg text-xs font-medium">{r}</span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-sm text-gray-400 italic">no restrictions</span>
                            )
                          )}

                          {/* Summary for ingredients */}
                          {idx === 1 && (
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-gray-600">
                              <span><span className="font-medium text-gray-500">fridge: </span>{mustInclude.trim() || <span className="italic text-gray-400">none</span>}</span>
                              <span><span className="font-medium text-gray-500">excluded: </span>{excluded.trim() || <span className="italic text-gray-400">none</span>}</span>
                            </div>
                          )}

                          {/* Summary for macros */}
                          {idx === 2 && (
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-gray-600">
                              {([ 
                                { key: "fat", label: "fat" },
                                { key: "carbs", label: "carbs" },
                                { key: "protein", label: "protein" },
                                { key: "calories", label: "calories" },
                              ]).filter(({ key }) => macros[key] !== "none").map(({ key, label }) => (
                                <span key={key}><span className="font-medium text-gray-500">{label}: </span>{macros[key]}</span>
                              ))}
                              {macros.fat === "none" && macros.carbs === "none" && macros.protein === "none" && macros.calories === "none" && (
                                <span className="italic text-gray-400">no macro targets</span>
                              )}
                            </div>
                          )}

                          {/* Summary for flavor & creativity */}
                          {idx === 3 && (
                            <div className="flex flex-col gap-1.5">
                              <div className="flex flex-wrap gap-1.5">
                                {[...primaryFlavors, ...secondaryFlavors].length > 0
                                  ? [...primaryFlavors, ...secondaryFlavors].map((f) => (
                                      <span key={f} className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded-lg text-xs font-medium">{f}</span>
                                    ))
                                  : <span className="italic text-gray-400 text-sm">no flavor preferences</span>
                                }
                              </div>
                              <div className="flex flex-wrap gap-x-4 text-xs text-gray-500">
                                <span><span className="font-medium">spice: </span>{spiceTolerance}</span>
                                <span><span className="font-medium">creativity: </span>{creativity}</span>
                              </div>
                            </div>
                          )}

                          {/* Summary for notes */}
                          {idx === 4 && (
                            <span className="text-sm text-gray-600">
                              {extraNotes.trim() || <span className="italic text-gray-400">no extra notes</span>}
                            </span>
                          )}
                        </div>
                        <ChevronDown size={18} className="flex-shrink-0 text-blue-400 mt-0.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── BRACKET PHASE ── */}
        {phase === "bracket" && (
          <div
            className="flex flex-col gap-5 w-full"
            style={{
              transition: "opacity 0.35s ease, transform 0.35s ease",
              opacity: roundVisible ? 1 : 0,
              transform: roundVisible ? "translateY(0)" : "translateY(14px)",
            }}
          >
            {/* Round header card */}
            <div className="bg-white rounded-2xl shadow-xl w-full p-5 flex flex-col gap-3">
              <RoundProgress currentRound={bracketRound} />
              <div className="text-center">
                <h2 className="text-xl sm:text-2xl font-black text-gray-800">{ROUND_LABELS[bracketRound].name}</h2>
                <p className="text-sm text-gray-500 mt-1">{ROUND_LABELS[bracketRound].subtitle}</p>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-1">
                <div className="text-xs text-gray-400 font-medium">
                  {Object.keys(picks).length} / {matchups.length} picked
                </div>
                <AdvanceButton />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl px-6 py-4 text-sm">
                {error}
              </div>
            )}

            {/* Matchup cards */}
            <div className="flex flex-col gap-4">
              {matchups.map((matchup, i) => (
                <MatchupCard
                  key={`r${bracketRound}-m${i}`}
                  matchup={matchup}
                  matchupIndex={i}
                  pick={picks[i]}
                  onPick={handlePick}
                  animating={animatingSet.has(i) ? (picks[i] === matchup[0] ? 'a' : 'b') : null}
                />
              ))}
            </div>

            {/* Bottom advance button */}
            <div className="flex justify-end pb-2">
              <div className="w-full sm:w-auto">
                <AdvanceButton />
              </div>
            </div>
          </div>
        )}

        {/* ── RESULTS PHASE ── */}
        {phase === "results" && mealPlan && (
          <>
            <Divider rotate={0} text="your winners" />

            {/* Champion meal cards */}
            <div className="flex flex-col md:flex-row gap-4 w-full">
              {[mealPlan.meal1, mealPlan.meal2].map((meal, i) => (
                <div key={i} className="bg-white rounded-2xl shadow-xl p-4 sm:p-6 flex flex-col gap-3 flex-1">
                  <div className="flex items-center gap-2">
                    <Trophy size={15} className="text-yellow-500" />
                    <span className="text-xs font-semibold text-yellow-600 uppercase tracking-widest">
                      champion {i + 1}
                    </span>
                  </div>
                  <h2 className="text-xl font-bold text-gray-800 leading-tight lowercase">{meal.title}</h2>
                  <p className="text-gray-500 text-sm italic">{meal.description}</p>
                  <div>
                    <div className="text-sm font-semibold text-gray-600 mb-2">how to make it</div>
                    <ul className="flex flex-col gap-1.5">
                      {(Array.isArray(meal.steps) ? meal.steps : [meal.steps]).map((step, j) => (
                        <li key={j} className="flex items-start gap-2 text-sm text-gray-700">
                          <span className="mt-1.5 w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" />
                          {step}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>

            <Divider rotate={0} text="shared grocery list" />

            <div className="bg-white rounded-2xl shadow-xl w-full p-4 sm:p-6 md:p-[2vw] mb-4">
              <div className="flex items-center gap-2 mb-4 text-gray-700 font-semibold">
                <ShoppingCart size={18} />
                everything you need for both dishes
              </div>
              <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2">
                {mealPlan.groceryList.map((item, i) => {
                  const match = item.match(/^(.+?)\s*(\(.*\))$/);
                  const name = match ? match[1].trim() : item;
                  const qty = match ? match[2] : null;
                  return (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="mt-1.5 w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" />
                      <span>
                        {name}
                        {qty && <span className="ml-1 text-gray-400 font-light">{qty}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Reset */}
            <div className="flex justify-center mb-6">
              <button
                onClick={handleReset}
                className="inline-flex items-center gap-2 bg-blue-700 hover:bg-blue-800 active:bg-blue-900 text-white font-semibold px-7 py-3 rounded-xl shadow transition-colors text-sm"
              >
                <Swords size={16} />
                start a new battle
              </button>
            </div>
          </>
        )}
      </div>
      <Footer />
    </>
  );
}

export default GroceryBattle;
