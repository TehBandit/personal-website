function placeLabel(index) {
  const place = index + 1;
  const suffix = place % 100 >= 11 && place % 100 <= 13 ? "th"
    : place % 10 === 1 ? "st" : place % 10 === 2 ? "nd" : place % 10 === 3 ? "rd" : "th";
  return `${place}${suffix}`;
}

export default function VoteResultBreakdown({ rankCounts, optionCount, maxCount }) {
  if (!Array.isArray(rankCounts) || rankCounts.length !== optionCount) {
    return <p className="bookclub-muted">Pick breakdown is unavailable for this vote.</p>;
  }
  return <div className="bookclub-breakdown">
    <span className="bookclub-label">Picks and points</span>
    <ul className="bookclub-pick-rows">
      {rankCounts.map((count, index) => {
        const weight = optionCount - index;
        const points = count * weight;
        return <li key={index}>
          <div className="bookclub-pick-label">
            <span>{placeLabel(index)} pick</span>
            <span className="bookclub-muted">{count} {count === 1 ? "pick" : "picks"} × {weight} {weight === 1 ? "pt" : "pts"} = {points} {points === 1 ? "pt" : "pts"}</span>
          </div>
          <div className="bookclub-pick-track" aria-hidden="true">
            <div className="bookclub-pick-bar" style={{ width: `${maxCount > 0 ? count / maxCount * 100 : 0}%` }} />
          </div>
        </li>;
      })}
    </ul>
  </div>;
}
