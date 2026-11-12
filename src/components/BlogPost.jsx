import { Link } from "react-router-dom";
import { PaperPin } from "./NotebookLayout.jsx";

function BlogPost({ isLeft = true, title, desc, date, machineDate, slug, tag = "General" }) {
  return (
    <li className={`blog-paper-row ${isLeft ? "blog-paper-left" : "blog-paper-right"}`}>
      <span className="blog-paper-node" aria-hidden="true" />
      <Link to={`/blog/${slug}`} className="blog-paper-card home-sheet group">
        {isLeft ? (
          <PaperPin />
        ) : (
          <span className="home-tape home-tape-blue blog-paper-tape" aria-hidden="true" />
        )}
        <article>
          <div className="blog-paper-meta font-home-mono">
            <time dateTime={machineDate}>{date}</time>
            <span className="blog-paper-meta-rule" aria-hidden="true" />
            <span>{tag.toLowerCase()}</span>
          </div>
          <h2>{title}</h2>
          {desc && <p>{desc}</p>}
          <span className="blog-paper-read font-home-hand">
            <span className="home-nav-highlight">read more</span>
            <span className="blog-paper-arrow" aria-hidden="true">↗</span>
          </span>
        </article>
      </Link>
    </li>
  );
}

export default BlogPost;
