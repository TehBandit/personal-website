export const NODE_TYPE_CONFIG = {
  character: { color: "#60a5fa", label: "Character" },
  location:  { color: "#34d399", label: "Location"  },
  faction:   { color: "#fb923c", label: "Faction"   },
  artifact:  { color: "#c084fc", label: "Artifact"  },
};

export const TYPE_PRESETS = {
  narrative: {
    label: "Narrative / Fiction",
    description: "Characters, locations, factions, and artifacts for worldbuilding",
    types: {
      character: { color: "#60a5fa", label: "Character" },
      location:  { color: "#34d399", label: "Location"  },
      faction:   { color: "#fb923c", label: "Faction"   },
      artifact:  { color: "#c084fc", label: "Artifact"  },
    },
  },
  notes: {
    label: "Study Notes",
    description: "Topics, sources, people, and concepts for research and study",
    types: {
      topic:   { color: "#60a5fa", label: "Topic"   },
      source:  { color: "#34d399", label: "Source"  },
      person:  { color: "#fb923c", label: "Person"  },
      concept: { color: "#c084fc", label: "Concept" },
    },
  },
  journaling: {
    label: "Journaling",
    description: "Entries, people, places, and reflections for personal journaling",
    types: {
      entry:      { color: "#60a5fa", label: "Entry"      },
      person:     { color: "#34d399", label: "Person"     },
      place:      { color: "#fb923c", label: "Place"      },
      reflection: { color: "#c084fc", label: "Reflection" },
    },
  },
  universal: {
    label: "Universal",
    description: "Entity, event, idea, and document \u2014 works for almost any purpose",
    types: {
      entity:   { color: "#60a5fa", label: "Entity"   },
      event:    { color: "#34d399", label: "Event"    },
      idea:     { color: "#fb923c", label: "Idea"     },
      document: { color: "#c084fc", label: "Document" },
    },
  },
  custom: {
    label: "Custom",
    description: "Start with the universal types and define your own later",
    types: {
      entity:   { color: "#60a5fa", label: "Entity"   },
      event:    { color: "#34d399", label: "Event"    },
      idea:     { color: "#fb923c", label: "Idea"     },
      document: { color: "#c084fc", label: "Document" },
    },
  },
};
