import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabaseUrl, publishableKey } from "./bookclubConfig.js";
import "./bookclub.css";

async function rpc(name, body) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "The vote could not be loaded. Please try again.");
  }
  const content = await response.text();
  return content ? JSON.parse(content) : null;
}

function browserVoterId() {
  const key = "bookclubr-guest-voter";
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export default function GuestBookVote() {
  const { code } = useParams();
  const [voterId] = useState(browserVoterId);
  const [vote, setVote] = useState(null);
  const [ranking, setRanking] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!/^[0-9a-f]{48}$/.test(code)) throw new Error("This guest vote link is invalid.");
    const result = await rpc("get_guest_vote", { p_code: code, p_voter: voterId });
    if (!result) throw new Error("This guest vote link is unavailable. Ask the organizer for a new link.");
    setVote(result);
    setRanking(result.my_ballot?.length === result.options.length
      ? result.my_ballot : result.options.map(option => option.id));
    setSaved(result.my_ballot?.length === result.options.length && result.options.length > 0);
  }, [code, voterId]);

  useEffect(() => {
    document.title = "Guest book vote | Bookclubr";
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow";
    document.head.appendChild(robots);
    load().catch(e => setError(e.message)).finally(() => setLoading(false));
    return () => { robots.remove(); };
  }, [load]);

  function move(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= ranking.length) return;
    setRanking(current => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setSaved(false);
  }

  async function submit() {
    setSaving(true); setError("");
    try {
      await rpc("submit_guest_ballot", { p_code: code, p_voter: voterId, p_options: ranking });
      await load();
      setSaved(true);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }

  const ordered = ranking.map(id => vote?.options.find(option => option.id === id)).filter(Boolean);
  const winner = vote?.options.find(option => option.id === vote.winner_option_id);
  return <main className="bookclub-shell">
    <div className="bookclub-wrap">
      <Link className="bookclub-brand" to="/bookclub">Bookclubr</Link>
      {loading ? <p className="bookclub-muted">Opening vote…</p> : <>
        {vote && <>
          <p className="bookclub-eyebrow">{vote.club_name} · {vote.status === "open" ? "Vote open" : "Vote closed"}</p>
          <h1 className="bookclub-title">{vote.title}</h1>
          {vote.status === "open" ? <>
            <div className="bookclub-card"><span className="bookclub-label">Live turnout</span><p>{vote.turnout} {vote.turnout === 1 ? "reader has" : "readers have"} voted</p></div>
            <div className="bookclub-card">
              <span className="bookclub-label">How it works</span>
              <p>Rank every book from your favorite to your least favorite. First place earns {vote.options.length} points. You can update your ballot from this browser until the organizer closes voting.</p>
            </div>
            <h2 className="bookclub-heading">Rank your choices</h2>
            {ordered.map((option, index) => <div className="bookclub-card" key={option.id}>
              <span className="bookclub-label">#{index + 1} · {ordered.length - index} points</span>
              <div className="bookclub-book" style={{ marginTop: 12 }}>
                {option.cover_url ? <img className="bookclub-cover" src={option.cover_url} alt="" /> : <div className="bookclub-cover" />}
                <div><h3 className="bookclub-book-title">{option.title}</h3><p className="bookclub-muted">{option.authors?.join(", ") || "Unknown author"}</p></div>
              </div>
              <div className="bookclub-controls">
                <button className="bookclub-button secondary" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${option.title} up`}>Move up</button>
                <button className="bookclub-button secondary" onClick={() => move(index, 1)} disabled={index === ordered.length - 1} aria-label={`Move ${option.title} down`}>Move down</button>
              </div>
            </div>)}
            {saved && <div className="bookclub-notice" role="status">Your ranked ballot is saved. You can change it until the vote closes.</div>}
            {error && <div className="bookclub-notice error" role="alert">{error}</div>}
            <button className="bookclub-button bookclub-submit" onClick={submit} disabled={saving || ordered.length < 2}>{saving ? "Saving…" : saved ? "Update my ballot" : "Submit my ballot"}</button>
            <p className="bookclub-muted">A shared link admits anyone who has it. This browser can update its ballot; another browser can submit separately.</p>
          </> : <>
            <div className="bookclub-card">
              <span className="bookclub-label">The club picked</span>
              <h2 className="bookclub-heading">{winner?.title || "Voting has ended"}</h2>
              {winner?.authors?.length > 0 && <p className="bookclub-muted">{winner.authors.join(", ")}</p>}
            </div>
            <h2 className="bookclub-heading">Final ranking</h2>
            {vote.results?.map((result, index) => {
              const option = vote.options.find(item => item.id === result.option_id);
              return option && <div className="bookclub-card" key={result.option_id}>
                <span className="bookclub-label">#{index + 1} · {result.points} points</span>
                <div className="bookclub-book" style={{ marginTop: 12 }}>
                  {option.cover_url ? <img className="bookclub-cover" src={option.cover_url} alt="" /> : <div className="bookclub-cover" />}
                  <div><h3 className="bookclub-book-title">{option.title}</h3><p className="bookclub-muted">{option.authors?.join(", ") || "Unknown author"}</p></div>
                </div>
              </div>;
            })}
            {saved && <div className="bookclub-notice">Your ballot was counted.</div>}
          </>}
        </>}
        {!vote && <div className="bookclub-notice error" role="alert">{error || "This vote is unavailable."}</div>}
      </>}
      <footer className="bookclub-footer">Bookclubr · Find your next read together.</footer>
    </div>
  </main>;
}
