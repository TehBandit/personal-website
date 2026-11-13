import { useEffect, useState } from "react";
import { pickBackgroundDoodles } from "./backgroundDoodles.js";

export default function useBackgroundDoodles(count = 3) {
  const [marks, setMarks] = useState([]);
  // Blog pages are prerendered. Add random decorations after hydration so the
  // server and initial client markup match, then keep them stable until unmount.
  useEffect(() => {
    setMarks(pickBackgroundDoodles(count));
  }, [count]);
  return marks;
}
