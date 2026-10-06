import { useEffect } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import "../pages/bookclub.css";

export default function BookclubPage({ title, description, path, children }) {
  const { hash } = useLocation();

  useEffect(() => {
    const target = hash ? document.getElementById(hash.slice(1)) : null;
    if (target) {
      if (target.tagName === "DETAILS") target.open = true;
      target.scrollIntoView();
    } else {
      window.scrollTo(0, 0);
    }
  }, [path, hash]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    const descriptionTag = document.createElement("meta");
    descriptionTag.name = "description";
    descriptionTag.content = description;
    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = `https://www.marcustaylor.org${path}`;
    document.head.append(descriptionTag, canonical);

    return () => {
      document.title = previousTitle;
      descriptionTag.remove();
      canonical.remove();
    };
  }, [title, description, path]);

  return <div className="bookclub-shell bookclub-public">
    <a className="bookclub-skip" href="#bookclub-content">Skip to content</a>
    <div className="bookclub-public-wrap">
      <nav className="bookclub-nav" aria-label="Bookclubr">
        <Link className="bookclub-brand" to="/bookclub">bookclubr<span>.</span></Link>
        <div className="bookclub-nav-links">
          <NavLink to="/bookclub" end>Overview</NavLink>
          <NavLink to="/bookclub/support">Support</NavLink>
          <NavLink to="/bookclub/privacy">Privacy</NavLink>
        </div>
      </nav>
      <main id="bookclub-content" tabIndex={-1}>{children}</main>
      <footer className="bookclub-public-footer">
        <p>Bookclubr by Marcus Taylor. Find your next read together.</p>
        <Link to="/bookclub/support">Get support</Link>
        <Link to="/bookclub/privacy">Privacy policy</Link>
        <Link to="/">Marcus Taylor</Link>
      </footer>
    </div>
  </div>;
}
