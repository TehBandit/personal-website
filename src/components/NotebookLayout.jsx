import { createElement, useId } from "react";
import { Github, Linkedin, Mail } from "lucide-react";
import { Link, NavLink } from "react-router-dom";
import SectionDoodle from "./SectionDoodle.jsx";
import "./NotebookLayout.css";

function SocialLinks() {
  return (
    <div className="flex items-center gap-1">
      <a className="notebook-social group" href="https://www.linkedin.com/in/taylor-marcus/" aria-label="LinkedIn" target="_blank" rel="noopener noreferrer"><Linkedin size={18} /></a>
      <a className="notebook-social group" href="https://github.com/TehBandit" aria-label="GitHub" target="_blank" rel="noopener noreferrer"><Github size={18} /></a>
      <Link className="notebook-social group" to="/contact" aria-label="Contact"><Mail size={18} /></Link>
    </div>
  );
}

export function NotebookTitle({ children, as: Tag = "h1", doodle = "pencil", action }) {
  return (
    <div className="notebook-title-row" data-drawn="true">
      <div className="notebook-title-heading">
        {createElement(Tag, { className: "font-home-hand notebook-title" }, children)}
        <SectionDoodle variant={doodle} className="notebook-title-doodle" />
      </div>
      <svg className="notebook-pencil-rule" viewBox="0 0 1000 20" preserveAspectRatio="none" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeLinecap="round">
          <path className="notebook-title-stroke" pathLength="1" d="M2 11 Q100 7 200 11 T400 10 T600 12 T800 9 T998 11" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          <path className="notebook-title-stroke" pathLength="1" d="M4 13 Q150 10 290 13 T580 11 T810 13 T996 12" strokeWidth="0.8" opacity="0.4" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
      {action && <div className="notebook-title-action">{action}</div>}
    </div>
  );
}

export function PaperPin({ tone = "home-pin-red", className = "" }) {
  const gradientId = useId();
  return (
    <svg className={`notebook-paper-pin ${tone} ${className}`} width="30" height="38" viewBox="0 0 30 38" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={gradientId} cx="35%" cy="30%" r="70%">
          <stop offset="0" stopColor="white" stopOpacity="0.85" />
          <stop offset="0.25" stopColor="var(--pin)" />
          <stop offset="1" stopColor="var(--pin)" />
        </radialGradient>
      </defs>
      <ellipse cx="19" cy="34" rx="7" ry="2.4" fill="var(--ink)" opacity="0.18" />
      <path d="M15 20 L17 33" stroke="var(--pin-metal)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8 16 Q15 22 22 16 L20 12 Q15 14 10 12 Z" fill="var(--pin)" />
      <circle cx="15" cy="9" r="8" fill={`url(#${gradientId})`} stroke="var(--ink)" strokeOpacity="0.2" />
    </svg>
  );
}

export default function NotebookLayout({ children }) {
  return (
    <div className="home-notebook-page notebook-layout flex flex-col">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Rock+Salt&family=Waiting+for+the+Sunrise&display=swap" />
      <div className="home-notebook-holes" aria-hidden="true" />
      <header className="sticky top-0 z-50 border-b border-home-rule backdrop-blur-md">
        <nav className="home-margin-content flex h-16 items-center justify-between gap-2" aria-label="Main navigation">
          <Link to="/" className="notebook-brand flex shrink-0 items-center gap-2" aria-label="mingus home">
            <img className="h-5 w-auto" alt="" src="/logo.png" />
            <img className="h-10 w-auto" alt="mingus." src="/mingus-transparent.png" />
          </Link>
          <div className="flex items-center gap-1 sm:gap-2">
            <NavLink to="/blog" className="notebook-nav-link group"><span className="home-nav-highlight">blog</span></NavLink>
            <NavLink to="/resume" className="notebook-nav-link group"><span className="home-nav-highlight">resume</span></NavLink>
            <span className="mx-1 hidden h-5 w-px bg-home-ink/10 sm:block" aria-hidden="true" />
            <div className="hidden sm:block"><SocialLinks /></div>
          </div>
        </nav>
      </header>
      {children}
      <footer className="home-margin-content mt-auto border-t border-home-rule py-8">
        <div className="mx-auto flex max-w-[1280px] flex-col items-center justify-between gap-4 sm:flex-row">
          <SocialLinks />
          <p className="font-home-hand text-lg text-home-ink-soft">© {new Date().getFullYear()} mingus</p>
        </div>
      </footer>
    </div>
  );
}
