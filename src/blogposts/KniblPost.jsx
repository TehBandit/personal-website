/* eslint-disable react-refresh/only-export-components */

export const meta = {
  title: "knibl - my new app for quickly creating, extracting, and connecting notes",
  desc: "a browser-based (and ios?) knowledge app for notes, files, sync, journaling, and chat",
  slug: "knibl",
  date: "6/2/2026",
  tag: "Development",
  headerPhotos: [
    "/chat1.png",
    "/analytics2.png",
    "/fullscreen%20upload.png",
  ],
};

export default function KniblPost() {
  return (
    <div>
      <p className="pb-4">
        knibl started from a pretty simple frustration: i wanted an alternative to tools that made me download apps, pay expensive subscriptions, and/or manually connect every concept, topic, and idea in my notes.
      </p>

      <p className="pb-4">
        i wanted something lighter, quicker, browser-based, download-free, and simple enough that I could start notetaking without needing to read any documentation or watch tutorials. plus, i wanted a cool project to put on my resume as a solo-dev success story.
        that automatically turns your notes into a connected universe as you use it.
      </p>

      <div className="my-6 border-l-4 border-blue-400 bg-blue-50 rounded-r-xl px-5 py-4 text-blue-900 text-base">
        <span className="font-semibold">try it yourself &rarr;</span>{" "}
        <a
          href="https://www.knibl.net/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline underline-offset-2"
        >
          knibl
        </a>{" "}
        is live now.
      </div>

      <p className="pb-2 font-semibold text-gray-800 text-lg">the value</p>

      <p className="pb-4">
        the core idea is that notetaking is enough of a process itself, manually defining backlinks and connections is just an annoying extra bit of maintenance. knibl automatically extracts
        major and minor entities from your notes, finds the connections between them, and keeps linking
        related entities as your graph evolves, instead of asking you to build the map by hand.
      </p>

      <p className="pb-4">
        the hope is that this approach makes it useful for writers,, students, and creators who are constantly moving between notes,
        and half-formed ideas. the app is meant to feel less like admin work and more like augmenting an existing process.
      </p>

      <p className="pb-2 font-semibold text-gray-800 text-lg">the design</p>

      <div className="pb-4 sm:flex sm:items-start sm:gap-6">
        <img
          src="/50_1x_shots_so.png"
          alt="knibl interface showing connected notes"
          className="mb-4 w-full sm:mb-0 sm:w-80 md:w-96 sm:flex-shrink-0"
        />
        <div>
          <p className="pb-4">
            coming up with the name was the first challenge. i wanted something that conveyed the sense of writing and notetaking, but also needed something that was simple, uncontested, and good for SEO obviously. I ended up with knibl (pronounce 'nibble') coming from the nib of a pen and then letting that transform into the mouse-based asthetic of the app since i like rodents.
          </p>

          <p className="pb-4">
            (note: if any graphic designers see this, i would love to work with you on some more mouse-based aethetics, branding, vectors, and animations - this stuff is hard.)
          </p>

          <p>
            the next step was adding ai. at one point it seemed like the perception was that ai cheapened many product experiences, but these days it seems like if you are trying to ship anything <span className="italic">without</span> ai, people start looking at you funny. so i wanted to add a way to use ai that felt genuinely helpful rather than a gimmicky "nice to have".
          </p>
        </div>
      </div>

      <p className="pb-4">
        the ai in this system is intended not to replace creative thinking, but to eliminate the monotony of expressing it. If you have existing text that you want to create notes from, the ai will identify the things in it that should get their own notes document and create boilerplates to build off of. if you are writing and reference an existing note, the ai will recognize that you are referencing an existing concept and automatically link them. 
      </p>

      <p className="pb-4">
        using notes as a knowledge base for querying has been beat to death already, so i wanted to take it a step further. in addition to the basic question-answering, i wanted to add some semantic knowledge to it; you can ask about how different entities are connected, regardless of whether they are directly linked or downstream. the chat works with the graph so that the different screens work together. and the chat can be used to track metadata such as how many connections exist, when notes were written, note tagging and filtering, rather than looking purely at note content.
      </p>

      <p className="pb-2 font-semibold text-gray-800 text-lg">whats next</p>

      <p className="pb-4">
        this is my first "paid" project, and i've invested a decent amount of time and capital into it, so i'm hoping to nurture it for a bit. the plan it to add in many layers for user feedback. to get these first users, I need to brush up on my marketing and outreach (i did spend 1 year as a marketing major woohoo) and get those first users.
      </p>

      <p className="pb-4">
        as far as goals, im hoping to soon release the ios version to help with accessibility. im hoping to keep working on this, getting the word out, collecting feedback, iterating until we start getting some paid users. once i hit $100 MRR that will be the first breakpoint - figure out what works, what doesn't, make some changes and decide whether to keep going all in on this project or move on to something new.
      </p>
    </div>
  );
}
