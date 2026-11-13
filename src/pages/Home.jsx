import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { posts } from "../blogposts";
import { formatDate } from "../utils/formatDate.js";
import SectionDoodle from "../components/SectionDoodle.jsx";
import BackgroundDoodle from "../components/BackgroundDoodle.jsx";
import useBackgroundDoodles from "../components/doodles/useBackgroundDoodles.js";
import InstagramFeed from "../components/InstagramFeed.jsx";

function HomeLink({ href, children, ...props }) {
  return href.startsWith("/") ? (
    <Link to={href} {...props}>{children}</Link>
  ) : (
    <a href={href} {...props}>{children}</a>
  );
}

/* ---------- drawing helpers ---------- */

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// A hand-drawn horizontal stroke: gentle drift + jitter, generated in code.
function pencilPath(seed, width = 1000, mid = 10) {
  const r = seeded(seed);
  const drift = (r() - 0.5) * 3;
  let d = `M 0 ${mid + (r() - 0.5) * 2}`;
  for (let x = 40; x <= width; x += 40) {
    const y = mid + Math.sin(x / 170 + seed) * 1.4 + (x / width) * drift + (r() - 0.5) * 1.6;
    d += ` L ${x} ${y.toFixed(2)}`;
  }
  return d;
}

function useDrawn() {
  const ref = useRef(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setDrawn(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, drawn };
}

function PencilLine({ seed }) {
  const a = useMemo(() => pencilPath(seed), [seed]);
  const b = useMemo(() => pencilPath(seed + 7, 1000, 11), [seed]);
  return (
    <svg className="h-5 w-full overflow-visible text-home-graphite" viewBox="0 0 1000 20" preserveAspectRatio="none" aria-hidden="true">
      <g filter="url(#graphite)" fill="none" stroke="currentColor" strokeLinecap="round">
        <path className="home-draw-path" pathLength={1} d={a} strokeWidth={1.8} opacity={0.85} vectorEffect="non-scaling-stroke" />
        <path className="home-draw-path [transition-delay:250ms]" pathLength={1} d={b} strokeWidth={1} opacity={0.45} vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}

function SectionHeading({ n, children, seed, doodle, tone, backgroundMark }) {
  const { ref, drawn } = useDrawn();
  return (
    <div ref={ref} data-drawn={drawn} className="relative mb-8 mt-20 flex items-end gap-4 md:mt-28">
      <BackgroundDoodle mark={backgroundMark} placement={n === "01" ? "right" : n === "02" ? "left" : "middle"} hideOnMobile={n === "02"} />
      <span className="home-rise-in pb-1 font-home-mono text-xs text-home-ink-soft">{n}</span>
      <h2 className="home-rise-in relative shrink-0 font-home-hand text-4xl font-bold leading-none text-home-ink md:text-5xl">{children}<SectionDoodle variant={doodle} tone={tone} className="absolute -right-6 -top-3" /></h2>
      <div className="mb-1 ml-4 flex-1">
        <PencilLine seed={seed} />
      </div>
    </div>
  );
}

function ScribbleUnderline() {
  return (
    <svg className="pointer-events-none absolute -bottom-2 left-0 h-3 w-full text-home-margin-red" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
      <path className="home-draw-path [transition-delay:1.6s]" pathLength={1} d="M2 7 C 20 3, 40 10, 60 5 S 90 4, 98 6 M 8 10 C 30 7, 60 11, 94 8" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function ScribbleCircle({ className = "-inset-x-4 -inset-y-3 h-[calc(100%+1.5rem)] w-[calc(100%+2rem)]", tone = "text-home-ink-blue" }) {
  return (
    <svg className={`pointer-events-none absolute ${className} ${tone}`} viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true">
      <path className="home-doodle" pathLength={1} d="M 30 8 C 80 0, 170 2, 192 22 C 205 40, 150 58, 95 56 C 40 55, 2 46, 6 28 C 9 14, 50 6, 120 6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function ScribbleWave({ tone = "text-home-margin-red" }) {
  return (
    <svg className={`pointer-events-none absolute -bottom-1 left-1 right-1 h-2 w-[calc(100%-0.5rem)] ${tone}`} viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
      <path className="home-doodle" pathLength={1} d="M1 5 Q 8 1, 15 5 T 29 5 T 43 5 T 57 5 T 71 5 T 85 5 T 99 4" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function QuestionDoodle() {
  return (
    <svg className="pointer-events-none absolute right-5 top-4 text-home-ink-soft" width="34" height="44" viewBox="0 0 34 44" aria-hidden="true">
      <path className="home-doodle" pathLength={1} d="M8 13 C 8 3, 27 2, 27 12 C 27 20, 17 20, 17 28 M 17 36 L 17.5 37" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

function PushPin({ tone = "home-pin-red", className = "" }) {
  return (
    <svg className={`pointer-events-none absolute z-10 ${tone} ${className}`} width="30" height="38" viewBox="0 0 30 38" aria-hidden="true">
      <defs>
        <radialGradient id={`pin-${tone}`} cx="35%" cy="30%" r="70%">
          <stop offset="0" stopColor="white" stopOpacity="0.85" />
          <stop offset="0.25" stopColor="var(--pin)" />
          <stop offset="1" stopColor="var(--pin)" />
        </radialGradient>
      </defs>
      <ellipse cx="19" cy="34" rx="7" ry="2.4" fill="var(--ink)" opacity="0.18" />
      <line x1="15" y1="20" x2="17" y2="33" stroke="var(--pin-metal)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8 16 Q 15 22 22 16 L 20 12 Q 15 14 10 12 Z" fill="var(--pin)" />
      <path d="M8 16 Q 15 22 22 16" fill="none" stroke="var(--ink)" strokeOpacity="0.25" />
      <circle cx="15" cy="9" r="8" fill={`url(#pin-${tone})`} />
      <circle cx="15" cy="9" r="8" fill="none" stroke="var(--ink)" strokeOpacity="0.2" />
    </svg>
  );
}

/* ---------- typed name ---------- */

const TYPED_NAMES = ["mingus.", "TehBandit.", "minkris.", "marcus."];

function TypedName() {
  const [text, setText] = useState("mingus.");
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0, len = TYPED_NAMES[0].length, deleting = true;
    let t = setTimeout(function tick() {
      const word = TYPED_NAMES[i] ?? "";
      if (!deleting) {
        len++;
        setText(word.slice(0, len));
        if (len >= word.length) { deleting = true; t = setTimeout(tick, 1800); return; }
        t = setTimeout(tick, 70 + Math.random() * 90);
      } else {
        len--;
        setText(word.slice(0, Math.max(len, 0)));
        if (len <= 0) { deleting = false; i = (i + 1) % TYPED_NAMES.length; t = setTimeout(tick, 350); return; }
        t = setTimeout(tick, 40);
      }
    }, 2200);
    return () => clearTimeout(t);
  }, []);
  return (
    <span aria-label="mingus" className="whitespace-nowrap font-home-name font-normal">
      <span aria-hidden="true">{text || "\u200b"}</span>
      <span className="home-type-caret" aria-hidden="true" />
    </span>
  );
}

/* ---------- icons ---------- */

const LinkedIn = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" /><rect width="4" height="12" x="2" y="9" /><circle cx="4" cy="4" r="2" /></svg>
);
const GitHub = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></svg>
);
const Mail = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" /><rect x="2" y="4" width="20" height="16" rx="2" /></svg>
);

const socials = [
  { label: "LinkedIn", href: "https://www.linkedin.com/in/taylor-marcus/", icon: <LinkedIn />, external: true },
  { label: "GitHub", href: "https://github.com/TehBandit", icon: <GitHub />, external: true },
  { label: "Contact", href: "/contact", icon: <Mail />, external: false },
];

function IconLinks() {
  return (
    <>
      {socials.map((s) => (
        <HomeLink
          key={s.label}
          aria-label={s.label}
          href={s.href}
          {...(s.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="group relative grid size-9 place-items-center rounded-full text-home-ink-soft transition hover:-rotate-6 hover:text-home-ink"
        >
          {s.icon}
          <ScribbleCircle className="-inset-1 h-[calc(100%+0.5rem)] w-[calc(100%+0.5rem)]" />
        </HomeLink>
      ))}
    </>
  );
}

/* ---------- page ---------- */

const projects = [
  { title: "grocery battle", desc: "Eliminate wasted leftovers with a bracket-style meal planner and grocery list generator.", href: "/grocerybattle", icon: "swords" },
  { title: "knibl", desc: "AI-enabled connected file editing, storage and sync.", href: "https://www.knibl.net/", img: "/knibble%20logo%20mini.png", external: true },
  { title: "Due or Die", desc: "A meaner task planner where deadlines have consequences.", href: "https://apps.apple.com/us/app/due-or-die-to-do-app-blocker/id6792173694", img: "/colonthree1024.png", external: true },
];

function Home() {
  const hero = useDrawn();
  const backgroundDoodles = useBackgroundDoodles();
  const [headingDoodles] = useState(() => {
    const pool = ["pencil", "speech-bubble", "lightbulb", "asterisk", "spiral", "sun", "lightning", "flower"];
    // Pick without replacement once per visit; unrelated renders keep the same marks.
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 3);
  });
  // Youtube API Setup
  const [latestVideoId, setLatestVideoId] = useState("");
  const [isLoadingVideo, setIsLoadingVideo] = useState(true);
  const [error, setError] = useState("");
  const CHANNEL_ID = "UCX-JpAVGwDuXLFF_RnJXWqA";

  const fetchLatestVideo = async () => {
    setIsLoadingVideo(true);
    setError("");
    try {
      const res = await fetch(
        `/api/youtube-search?channelId=${CHANNEL_ID}&maxResults=1`
      );
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch from backend.");
      }

      const data = await res.json();

      if (!data.items || data.items.length === 0) {
        throw new Error("No videos found in response.");
      }

      const videoId = data.items[0]?.id?.videoId;
      if (!videoId) {
        throw new Error("No video ID found in API response.");
      }

      setLatestVideoId(videoId);
    } catch (err) {
      console.error(err);
      setLatestVideoId("");
      setError(err.message || "Unexpected error fetching video.");
    } finally {
      setIsLoadingVideo(false);
    }
  };

  // Runs when Home page loads
  useEffect(() => {
    fetchLatestVideo();
  }, []);

  return (
    <div className="home-notebook-page flex flex-col">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Rock+Salt&family=Waiting+for+the+Sunrise&display=swap" />
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <filter id="graphite">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" />
        </filter>
      </svg>
      <div className="home-notebook-holes" />

      <header className="sticky top-0 z-50 border-b border-home-rule bg-home-paper/80 backdrop-blur-md">
        <nav className="home-margin-content flex h-16 items-center justify-between">
          <HomeLink href="/" className="flex items-center gap-2" aria-label="mingus home">
            <img className="h-5 w-auto" alt="" src="/logo.png" />
            <img className="h-10 w-auto" alt="mingus." src="/mingus-transparent.png" />
          </HomeLink>
          <div className="flex items-center gap-1 sm:gap-2">
            <HomeLink href="/blog" className="group relative px-3 py-1.5 text-sm font-medium text-home-ink-soft transition hover:text-home-ink"><span className="home-nav-highlight">blog</span></HomeLink>
            <HomeLink href="/resume" className="group relative px-3 py-1.5 text-sm font-medium text-home-ink-soft transition hover:text-home-ink"><span className="home-nav-highlight">resume</span></HomeLink>
            <span className="mx-1 hidden h-5 w-px bg-home-ink/10 sm:block" />
            <div className="hidden items-center sm:flex"><IconLinks /></div>
          </div>
        </nav>
      </header>

      <main className="home-margin-content mx-auto w-full max-w-[1280px] grow pb-24">
        {/* hero */}
        <section ref={hero.ref} data-drawn={hero.drawn} className="grid items-center gap-10 pt-14 md:grid-cols-[auto_1fr] md:gap-16 md:pt-24">
          <div className="relative mx-auto w-64 max-w-[calc(100%-2rem)] -rotate-3 md:mx-0 md:w-72 lg:w-96">
            <div className="home-tape -top-3 left-1/2 -translate-x-1/2 rotate-2" />
            <div className="home-tape home-tape-blue -bottom-2 -right-6 w-16 -rotate-[38deg]" />
            <div className="home-sheet p-3 pb-10">
              <img className="aspect-square w-full rounded-md object-cover" alt="Portrait of mingus" src="/profile.jpg" />
            </div>
            <span className="absolute bottom-2 left-0 right-0 text-center font-home-hand text-xl text-home-ink-soft">me</span>
          </div>

          <div className="min-w-0">
            <p className="home-rise-in mb-3 font-home-hand text-lg uppercase tracking-[0.2em] text-home-ink-soft">hi, i'm</p>
            <h1 className="text-[clamp(3.25rem,9vw,7.5rem)] font-semibold leading-[0.95] tracking-[-0.045em] text-home-ink">
              <TypedName />
            </h1>
            <p className="home-rise-in mt-6 max-w-xl text-xl leading-relaxed text-home-ink-soft [transition-delay:200ms] md:text-2xl">
              brooklyn-based <span className="home-highlight text-home-ink">artist</span>, activist,{" "}
              <span className="relative inline-block text-home-ink">unc<ScribbleUnderline /></span>
            </p>
            <div className="mt-8 flex items-center gap-1 sm:hidden"><IconLinks /></div>
          </div>
        </section>

        {/* blog */}
        <SectionHeading n="01" seed={11} doodle={headingDoodles[0]} tone="text-home-margin-red" backgroundMark={backgroundDoodles[0]}>latest blog post</SectionHeading>
        <HomeLink href={`/blog/${posts[0].meta.slug}`} className="group home-sheet relative block p-6 transition duration-300 hover:-translate-y-0.5 hover:shadow-home-lift md:p-10">
          <PushPin tone="home-pin-red" className="home-pin-wiggle -top-4 left-1/2 -translate-x-1/2" />
          <div className="flex items-center gap-3 font-home-mono text-xs text-home-ink-soft">
            <time dateTime={posts[0].meta.date}>{formatDate(posts[0].meta.date).split("/").map((part) => part.padStart(2, "0")).join(".")}</time>
            <span className="h-px w-6 bg-home-ink/20" />
            <span>dev log</span>
          </div>
          <h3 className="mt-4 max-w-3xl text-2xl font-semibold leading-tight tracking-tight text-home-ink md:text-4xl">
            {posts[0].meta.title}
          </h3>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-home-ink-soft md:text-lg">
            {posts[0].meta.desc}
          </p>
          <span className="relative mt-6 inline-flex items-center gap-2 font-home-hand text-2xl text-home-ink-blue">
            <ScribbleCircle className="-inset-x-5 -inset-y-2 h-[calc(100%+1rem)] w-[calc(100%+2.5rem)]" tone="text-home-margin-red" />
            read full post
            <svg width="34" height="14" viewBox="0 0 34 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="transition-transform group-hover:translate-x-1" aria-hidden="true"><path d="M1 8 C 10 6, 20 8, 31 7 M 25 2 L 32 7 L 25 12" /></svg>
          </span>
        </HomeLink>

        {/* socials */}
        <SectionHeading n="02" seed={23} doodle={headingDoodles[1]} tone="text-home-ink-blue" backgroundMark={backgroundDoodles[1]}>latest socials</SectionHeading>
        <div className="grid items-start gap-6 md:grid-cols-2">
          <figure className="group home-sheet relative rotate-[-0.6deg] p-4 transition hover:rotate-0">
            <div className="home-tape home-tape-lift -top-3 left-8 -rotate-6" />
            <figcaption className="mb-3 flex flex-col gap-1 px-1 sm:flex-row sm:items-baseline sm:justify-between">
              <span className="relative font-home-hand text-2xl text-home-ink sm:text-3xl">YouTube<ScribbleWave /></span>
              <span className="font-home-mono text-xs text-home-ink-soft">latest short</span>
            </figcaption>
            <div className="aspect-video overflow-hidden rounded-lg bg-home-ink/5">
              {error && <p className="px-2 py-1 text-sm text-red-500">{error}</p>}
              {!error && isLoadingVideo && (
                <div className="flex h-full w-full items-center justify-center text-sm text-home-ink-soft">
                  loading latest video...
                </div>
              )}
              {!error && !isLoadingVideo && latestVideoId && (
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${latestVideoId}`}
                  title="YouTube video player"
                  frameBorder="0"
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                  className="h-full w-full"
                />
              )}
            </div>
          </figure>
          <figure className="group home-sheet relative min-w-0 rotate-[0.6deg] p-4 transition hover:rotate-0">
            <PushPin tone="home-pin-blue" className="home-pin-wiggle -top-5 right-10" />
            <figcaption className="mb-3 flex flex-col gap-1 px-1 sm:flex-row sm:items-baseline sm:justify-between">
              <a href="https://www.instagram.com/artworkbymarcus/" target="_blank" rel="noopener noreferrer" className="relative font-home-hand text-2xl text-home-ink sm:text-3xl">(art) instagram<ScribbleWave tone="text-home-ink-blue" /></a>
              <span className="font-home-mono text-xs text-home-ink-soft">latest post</span>
            </figcaption>
            <div className="aspect-video overflow-hidden rounded-lg bg-home-ink/5">
              <InstagramFeed />
            </div>
          </figure>
        </div>

        {/* projects */}
        <SectionHeading n="03" seed={37} doodle={headingDoodles[2]} tone="text-home-margin-red" backgroundMark={backgroundDoodles[2]}>projects</SectionHeading>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p, i) => (
            <HomeLink
              key={p.title}
              href={p.href}
              {...(p.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="group home-sheet relative flex min-h-52 flex-col p-6 outline-none transition duration-300 hover:-translate-y-1 hover:shadow-home-lift"
            >
              {i === 1 ? (
                <div className="home-tape home-tape-blue home-tape-lift -top-3 right-6 w-20 rotate-[4deg]" />
              ) : (
                <PushPin tone={i === 0 ? "home-pin-yellow" : "home-pin-red"} className="home-pin-wiggle -top-4 right-6" />
              )}
              <div className="grid size-11 place-items-center overflow-hidden rounded-xl bg-home-ink/5">
                {p.img ? (
                  <img className="size-11 object-contain" alt="" src={p.img} />
                ) : (
                  <svg className="text-home-ink-blue" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" /><line x1="13" x2="19" y1="19" y2="13" /><line x1="16" x2="20" y1="16" y2="20" /><line x1="19" x2="21" y1="21" y2="19" /><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" /><line x1="5" x2="9" y1="14" y2="18" /><line x1="7" x2="4" y1="17" y2="20" /><line x1="3" x2="5" y1="19" y2="21" /></svg>
                )}
              </div>
              <h3 className="relative mt-auto inline-block self-start pt-8 text-xl font-semibold tracking-tight text-home-ink">
                <span className="relative">{p.title}<ScribbleCircle /></span>
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-home-ink-soft">{p.desc}</p>
            </HomeLink>
          ))}
          {[0, 1].map((i) => (
            <div key={i} className="group relative flex min-h-52 flex-col items-center justify-center rounded-[14px] border-2 border-dashed border-home-ink/15 p-6 text-center">
              <QuestionDoodle />
              <span className="font-home-hand text-3xl text-home-ink-soft">untitled project</span>
              <span className="mt-1 font-home-mono text-xs text-home-ink-soft/70">coming soon…</span>
            </div>
          ))}
        </div>
      </main>

      <footer className="home-margin-content border-t border-home-rule py-8">
        <div className="mx-auto flex max-w-[1280px] flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-1"><IconLinks /></div>
          <p className="font-home-hand text-lg text-home-ink-soft">© {new Date().getFullYear()} mingus</p>
        </div>
      </footer>
    </div>
  );
}

export default Home;
