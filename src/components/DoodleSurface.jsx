import BackgroundDoodle from "./BackgroundDoodle.jsx";
import useBackgroundDoodles from "./doodles/useBackgroundDoodles.js";

export default function DoodleSurface({ children }) {
  const marks = useBackgroundDoodles();
  return (
    <div className="doodle-surface">
      <BackgroundDoodle mark={marks[0]} placement="right" />
      <BackgroundDoodle mark={marks[1]} placement="left" hideOnMobile />
      <BackgroundDoodle mark={marks[2]} placement="middle" />
      {children}
    </div>
  );
}
