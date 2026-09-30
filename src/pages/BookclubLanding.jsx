import { Link } from "react-router-dom";
import "./bookclub.css";

export default function BookclubLanding() {
  return <main className="bookclub-shell">
    <div className="bookclub-wrap">
      <Link className="bookclub-brand" to="/bookclub">Bookclubr</Link>
      <p className="bookclub-eyebrow">Read together</p>
      <h1 className="bookclub-title">A better way to pick the next book.</h1>
      <div className="bookclub-card">
        <span className="bookclub-label">Guest voting</span>
        <p>When a club organizer shares a vote link with you, open it to rank the nominated books right here. You do not need to download the app.</p>
      </div>
      <p className="bookclub-muted">Ask your club organizer for a guest vote link to take part.</p>
      <footer className="bookclub-footer">Bookclubr · Find your next read together.</footer>
    </div>
  </main>;
}
