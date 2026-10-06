import { Link } from "react-router-dom";
import BookclubPage from "../components/BookclubPage.jsx";

export default function BookclubLanding() {
  return <BookclubPage
    title="Bookclubr | Read together"
    description="Your books, your people, all in one place. Discover books, organize your book club, vote on your next read, and keep reading together with Bookclubr for iPhone."
    path="/bookclub"
  >
    <section className="bookclub-hero" aria-labelledby="bookclub-intro">
      <div>
        <p className="bookclub-eyebrow">For iPhone · Read together</p>
        <h1 id="bookclub-intro" className="bookclub-title">Your next chapter,<br />shared.</h1>
        <p className="bookclub-lead">Your books, your people, all in one place. Bookclubr brings your reading life and your book club together, from the first nomination to the last page.</p>
        <div className="bookclub-actions">
          <a className="bookclub-button" href="#reading-together">Explore Bookclubr</a>
          <Link className="bookclub-button secondary" to="/bookclub/support">Get support</Link>
        </div>
      </div>
      <aside className="bookclub-reading-note" aria-label="A book club's next chapter">
        <span className="bookclub-label">One club. Many perspectives.</span>
        <h2>Good books.<br />Better company.</h2>
        <ol>
          <li><span>01</span> Nominate your next read</li>
          <li><span>02</span> Rank the club's picks</li>
          <li><span>03</span> Read, react, discuss</li>
        </ol>
        <p>Make room for everyone's next favorite.</p>
      </aside>
    </section>

    <section id="reading-together" className="bookclub-section" aria-labelledby="bookclub-features">
      <p className="bookclub-eyebrow">A place for your reading life</p>
      <h2 id="bookclub-features" className="bookclub-section-title">Less organizing. More reading.</h2>
      <div className="bookclub-feature-grid">
        <article className="bookclub-card">
          <span className="bookclub-label">Your shelves</span>
          <h3>Keep your next read close.</h3>
          <p>Discover books and keep track of what you want to read, what you're reading, and what you've finished. Add ratings and reviews, or bring your library over from Goodreads.</p>
        </article>
        <article className="bookclub-card">
          <span className="bookclub-label">Your club</span>
          <h3>Find your reading people.</h3>
          <p>Create a club or find one to join. Share updates, reply to your clubmates, and turn a solitary chapter into a conversation.</p>
        </article>
        <article className="bookclub-card">
          <span className="bookclub-label">Your next pick</span>
          <h3>Give every book a chance.</h3>
          <p>Nominate books and rank the options together. Organizers can share a guest link so friends can take part in the browser without installing the app.</p>
        </article>
        <article className="bookclub-card">
          <span className="bookclub-label">Your shared pace</span>
          <h3>Stay on the same page.</h3>
          <p>Set page or chapter goals, check off your progress, and cheer each other on with reactions and replies. Keep discussion locations and reading deadlines together, with optional calendar reminders.</p>
        </article>
      </div>
    </section>

    <section className="bookclub-card bookclub-guest-info" aria-labelledby="bookclub-guest-heading">
      <div>
        <span className="bookclub-label">Here for a guest vote?</span>
        <h2 id="bookclub-guest-heading" className="bookclub-heading">A seat at the table, no app needed.</h2>
        <p>Open the personal vote link your club organizer shared to nominate or rank books. Each link belongs to a specific club vote; ask your organizer for one to get started.</p>
      </div>
      <Link className="bookclub-text-link" to="/bookclub/support#guest-voting">Help with guest voting →</Link>
    </section>
  </BookclubPage>;
}
