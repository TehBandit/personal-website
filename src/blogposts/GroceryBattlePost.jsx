import { Link } from "react-router-dom";

export const meta = {
  title: "i built a tournament-style bracket to help with grocery shopping",
  desc: "no more wasted ingredients or making the same meals on repeat",
  slug: "grocery-battle",
  date: "2/28/2026",
  tag: "Development",
  headerPhotos: ["/gb1.png", "/gb2.png"],
};

export default function GroceryBattlePost() {
  return (
    <div>
      <p className="pb-4">
        one problem i've routinely run into as a home cook is trying to be creative and try new meals without having a bunch of the ingredients leftover that i may not use before they go bad. if im buying heavy cream for tuscan chicken, im likely stuck either making way more than i planned for to use it all up, or leaving it in the fridge until it inevitably goes bad. i didnt't want this to limit what i can cook, so i wanted a solution that would help me plan a variety of meals with the ingredients i wanted to use so i can minimize waste and expense.
      </p>

      {/* ── inline callout ── */}
      <div className="my-6 border-l-4 border-blue-400 bg-blue-50 rounded-r-xl px-5 py-4 text-blue-900 text-base">
        <span className="font-semibold">try it yourself →</span>{" "}
        <Link to="/grocerybattle" className="text-blue-600 underline underline-offset-2">
          grocery battle
        </Link>{" "}
        is live on this site right now.
      </div>

      <p className="pb-4">
        i started just with a simple recipe generator that would take in some preferences and then output a list of meals i could make. i even added a reroll button to gamify it and help narrow down options, but i dont think it really solved the core problem. i had meredith try it, and she mentioned that how it was set up was too constricting, it left it either a yes/no choice of whether you liked what it came up with; it'd be better if you could choose 'this vs. that' until you got what you wanted.
      </p>

      <p className="pb-4">
        and so, grocery battle.
      </p>

      {/* ── section heading ── */}
      <p className="pb-2 font-semibold text-gray-800 text-lg">how it works</p>

      <p className="pb-4">
        you start by telling it what you're in the mood for: flavor profile (sweet, salty, umami,
        sour, bitter), vibe descriptors (smoky, herbaceous, comfort food, bright, etc.), spice
        tolerance, dietary restrictions, stuff you want to avoid, and anything you specifically
        want to use up. the ai takes all of that and feeds it to gpt-4o, which generates 16 unique dishes, seeded into a bracket.
      </p>

      <p className="pb-4">
        after working through the rounds, it gives you a grocery list for the winning items so that you can get at least 2 solid dishes with several servings each (how much I typically plan for a single grocery run) using the preferences you're feeling.
      </p>

      <p className="pb-4">
        the backend is a handful of vercel serverless functions, one to generate the initial 16 dishes
        and one to generate the grocery list from the finalists. i added input validation and guardrails on
        every text field to avoid prompt injection since these are public-facing endpoints. nothing crazy,
        but just in case.
      </p>

      <p className="pb-2 font-semibold text-gray-800 text-lg">next steps</p>

      <p className="pb-4">
        im pretty happy with how it turned out! when i get around to some new features, id love to ground the meals in actual recipes, pulling from some sort of resource or RAG knowledge base to include links to real recipes from professional chefs, limit ai making up bogus meals, etc. also, would love to include little images to include on the cards for each winner, but both of these end up costing money, so i'll add it to the backlog for now.
      </p>
    </div>
  );
}
