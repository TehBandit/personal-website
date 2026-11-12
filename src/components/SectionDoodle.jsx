// Deliberately uneven curves give each small mark a pen-drawn feel.
const doodles = {
  pencil: "M4.2 15.8 Q9.8 9.3 16.6 3.7 Q17.6 2.8 18.7 3.9 L20.2 5.4 Q21.3 6.5 20.2 7.5 L8.1 19.3 L3.2 20.8 Z M4.2 15.8 L8.1 19.3 M14.8 5.5 L18.4 9.3 M6.4 16.7 Q11.9 10.7 17.2 6.8 M3.8 18.6 L5.5 20",
  "speech-bubble": "M5.1 4.8 Q11.4 2.5 17.7 4.5 Q21.9 5.9 21 12.2 Q20.3 17.1 14.3 17.2 L9.8 17 L5.1 20.4 L5.8 16 Q2.5 14.5 3 10.1 Q3.1 6.5 5.1 4.8 M7.4 9.5 Q11.3 9 16.7 9.4 M7.6 12.8 Q11.4 12.4 14 12.8",
  lightbulb: "M8.5 16.1 C8.2 13.6 4.9 12.2 5.3 8.2 C5.8 1 17.9 1 18.6 8.1 C19 12.1 15.4 13.7 15.1 16.3 Z M8.6 19 Q11.6 19.5 15 18.9 M10.3 21.5 L13.6 21.3 M11.7 16 L11.9 10.7 M9.1 9.1 L11.9 11.1 L14.6 8.7",
  asterisk: "M11.3 2.8 Q12.2 11.1 12.7 21.2 M3.6 7 Q11.8 11.7 20.1 16.9 M3.9 17.5 Q12.2 11.3 20.3 6.1",
  spiral: "M20.5 13 C21.8 5.2 14.4 .9 7.8 4.4 C.6 8.3 3.2 19.3 11 20.2 C17.7 21 21 14.3 17.4 9.9 C14.3 6 8.1 7.4 7.8 12.3 C7.6 16.2 12.5 17.5 14.3 14.8 C15.5 12.9 13.5 11.1 11.9 12.4",
  sun: "M16.9 11.9 C17.5 18.2 6.3 18.9 6.8 12.1 C6.3 5.9 17.1 5.5 16.9 11.9 Z M11.6 1.6 L11.9 4.1 M18.8 4.2 L17 6.3 M20.1 11.2 L22.3 11.5 M18.1 17.9 L20 20 M12.4 20 L12.1 22.1 M5.9 18.2 L4.1 20.2 M1.8 12.4 L4.1 12 M4.2 4.3 L6.1 6.2",
  lightning: "M13.5 2.1 Q9.4 7.5 5.6 13.1 L11.4 12.6 L9.7 21.7 Q14.4 15.5 18.7 9.6 L12.8 10.1 Z",
  flower: "M10 9 C5.2 5.4 8.5 .3 11.6 3.2 C14.8 -.2 19.2 4.8 15.1 8.7 C21.5 6.6 23.5 13.1 17.2 14.1 C22 18.3 16.3 22.5 13 17 C11.2 23.2 5.2 21.7 7.8 15.9 C1.5 18 0 11.6 6.7 11.3 C2.7 6.7 6.3 3.7 10 9 Z M14 11.5 C14.2 14.9 9.3 15.1 9.2 12 C8.9 8.7 13.9 8.3 14 11.5 Z",
};

export default function SectionDoodle({ variant = "pencil", tone = "text-home-margin-red", className = "", size = 22, animated = true }) {
  return (
    <svg
      className={`pointer-events-none ${tone} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className={animated ? "home-draw-path [transition-delay:900ms]" : undefined}
        pathLength={1}
        d={doodles[variant] ?? doodles.pencil}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
