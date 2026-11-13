import { BACKGROUND_DOODLES } from "./doodles/backgroundDoodles.js";
import "./BackgroundDoodle.css";

export default function BackgroundDoodle({ mark, placement = "left", hideOnMobile = false }) {
  if (!mark) return null;

  return (
    <div
      className={`background-doodle background-doodle--${placement}${hideOnMobile ? " background-doodle--desktop" : ""}`}
      style={{
        "--doodle-rotation": `${mark.rotation}deg`,
        "--doodle-offset": `${mark.offset}px`,
      }}
      aria-hidden="true"
    >
      <svg width={mark.size} height={mark.size} viewBox="0 0 24 24" focusable="false">
        <path d={BACKGROUND_DOODLES[mark.variant]} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
