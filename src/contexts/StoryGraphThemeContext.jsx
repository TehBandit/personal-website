import { createContext, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "storygraph-theme";

const THEMES = {
  dark: {
    id: "dark",
    label: "Dark",
    fontFamily: '"Open Sans", sans-serif',
    colors: {
      bg: "#0f0f1a",
      surface: "#161624",
      surfaceAlt: "#13131F",
      text: "rgba(255,255,255,0.88)",
      textStrong: "rgba(255,255,255,0.94)",
      muted: "rgba(255,255,255,0.45)",
      softText: "rgba(255,255,255,0.35)",
      border: "rgba(255,255,255,0.10)",
      borderSoft: "rgba(255,255,255,0.07)",
      accent: "#60a5fa",
      accentStrong: "#93c5fd",
      accentSoft: "rgba(96,165,250,0.16)",
      warning: "#FB923C",
      success: "#22C55E",
      danger: "#FCA5A5",
      overlay: "rgba(10,10,20,0.88)",
    },
  },
  typewriter: {
    id: "typewriter",
    label: "Typewriter",
    fontFamily: '"Open Sans", sans-serif',
    colors: {
      bg: "#4A4A4A",
      surface: "#595959",
      surfaceAlt: "#646464",
      text: "#FFFFE3",
      textStrong: "#FFFFE3",
      muted: "rgba(255,255,227,0.78)",
      softText: "rgba(255,255,227,0.62)",
      border: "rgba(255,255,227,0.20)",
      borderSoft: "rgba(255,255,227,0.14)",
      accent: "#6D8196",
      accentStrong: "#CBD7E2",
      accentSoft: "rgba(109,129,150,0.28)",
      warning: "#CBCBCB",
      success: "#C8DACA",
      danger: "#EAB6A3",
      overlay: "rgba(74,74,74,0.88)",
    },
  },
  polaroid: {
    id: "polaroid",
    label: "Polaroid",
    fontFamily: '"Open Sans", sans-serif',
    colors: {
      bg: "#FDFBD4",
      surface: "#ECE9C8",
      surfaceAlt: "#D9D7B6",
      text: "#545333",
      textStrong: "#454427",
      muted: "rgba(84,83,51,0.78)",
      softText: "rgba(84,83,51,0.60)",
      border: "rgba(84,83,51,0.22)",
      borderSoft: "rgba(84,83,51,0.14)",
      accent: "#878672",
      accentStrong: "#545333",
      accentSoft: "rgba(135,134,114,0.24)",
      warning: "#878672",
      success: "#74805E",
      danger: "#A16858",
      overlay: "rgba(253,251,212,0.92)",
    },
  },
  urban: {
    id: "urban",
    label: "Urban",
    fontFamily: '"Open Sans", sans-serif',
    colors: {
      bg: "#111111",
      surface: "#1F1F1F",
      surfaceAlt: "#2A2A2A",
      text: "#D8D7D7",
      textStrong: "#F0EFEF",
      muted: "rgba(156,154,154,0.78)",
      softText: "rgba(156,154,154,0.58)",
      border: "rgba(156,154,154,0.22)",
      borderSoft: "rgba(156,154,154,0.14)",
      accent: "#A35E47",
      accentStrong: "#CB8B75",
      accentSoft: "rgba(163,94,71,0.24)",
      warning: "#A35E47",
      success: "#8EA39E",
      danger: "#CF7D67",
      overlay: "rgba(17,17,17,0.90)",
    },
  },
  light: {
    id: "light",
    label: "Light",
    fontFamily: '"Open Sans", sans-serif',
    colors: {
      bg: "#BDDDFC",
      surface: "#A9D0F4",
      surfaceAlt: "#88BDF2",
      text: "#384959",
      textStrong: "#273744",
      muted: "rgba(56,73,89,0.76)",
      softText: "rgba(56,73,89,0.58)",
      border: "rgba(56,73,89,0.22)",
      borderSoft: "rgba(56,73,89,0.14)",
      accent: "#6A89A7",
      accentStrong: "#384959",
      accentSoft: "rgba(106,137,167,0.24)",
      warning: "#6A89A7",
      success: "#4E7D6B",
      danger: "#A35E47",
      overlay: "rgba(189,221,252,0.92)",
    },
  },
};

const StoryGraphThemeContext = createContext(null);

export function StoryGraphThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(() => {
    if (typeof window === "undefined") return "dark";
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return THEMES[saved] ? saved : "dark";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, themeId);
  }, [themeId]);

  const value = useMemo(() => {
    const theme = THEMES[themeId] || THEMES.dark;
    return {
      themeId: theme.id,
      theme,
      themes: Object.values(THEMES),
      setThemeId,
    };
  }, [themeId]);

  return (
    <StoryGraphThemeContext.Provider value={value}>
      {children}
    </StoryGraphThemeContext.Provider>
  );
}

export function useStoryGraphTheme() {
  const ctx = useContext(StoryGraphThemeContext);
  if (!ctx) {
    throw new Error("useStoryGraphTheme must be used within StoryGraphThemeProvider");
  }
  return ctx;
}
