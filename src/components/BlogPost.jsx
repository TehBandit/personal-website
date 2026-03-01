import { Link } from "react-router-dom";

const tagStyles = {
  Personal:    "bg-blue-50 text-blue-600 border border-blue-200",
  Development: "bg-violet-50 text-violet-600 border border-violet-200",
  Travel:      "bg-emerald-50 text-emerald-600 border border-emerald-200",
  Food:        "bg-orange-50 text-orange-600 border border-orange-200",
};

function BlogPost({
  isLeft = true,
  title = "Title",
  desc = "Description",
  date = "00/00/0000",
  slug = "404",
  tag = "General",
}) {
  const tagStyle = tagStyles[tag] ?? "bg-gray-100 text-gray-500 border border-gray-200";

  const Card = () => (
    <Link to={slug} className="block group w-full max-w-md">
      <article
        className={`
          relative bg-white rounded-2xl border border-gray-100 shadow-sm p-6
          transition-all duration-300
          group-hover:-translate-y-1 group-hover:shadow-lg group-hover:border-gray-200
          ${isLeft ? "border-r-2 border-r-gray-200" : "border-l-2 border-l-gray-200"}
        `}
      >
        {/* Tag + date row */}
        <div className={`flex items-center gap-2 mb-3 ${isLeft ? "justify-end" : "justify-start"}`}>
          <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${tagStyle}`}>
            {tag}
          </span>
          <span className="text-xs text-gray-400 tabular-nums">{date}</span>
        </div>

        {/* Title */}
        <h2
          className={`text-[1.05rem] font-semibold text-gray-900 leading-snug mb-2
            group-hover:text-blue-600 transition-colors duration-200
            ${isLeft ? "text-right" : "text-left"}`}
        >
          {title}
        </h2>

        {/* Description */}
        <p className={`text-sm text-gray-500 leading-relaxed mb-4 ${isLeft ? "text-right" : "text-left"}`}>
          {desc}
        </p>

        {/* CTA */}
        <div className={`flex items-center gap-1 text-sm font-medium text-blue-500 ${isLeft ? "justify-end" : "justify-start"}`}>
          <span>read more</span>
          <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
        </div>
      </article>
    </Link>
  );

  return (
    // On mobile: single-column. On md+: alternating spine layout.
    <>
      {/* ── Mobile (< md): simple stacked card ── */}
      <div className="md:hidden flex flex-col items-start gap-1 mb-8">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full bg-gray-400 flex-shrink-0" />
          <span className="text-xs text-gray-400 tabular-nums">{date}</span>
        </div>
        <div className="ml-4 w-full">
          <Card />
        </div>
      </div>

      {/* ── Desktop (≥ md): alternating spine layout ── */}
      <div className="hidden md:flex items-center w-full mb-14">
        {/* Left half */}
        <div className="flex-1 flex justify-end pr-5">
          {isLeft ? (
            <Card />
          ) : (
            <span className="text-xs text-gray-400 font-light tracking-wide tabular-nums select-none">
              {date}
            </span>
          )}
        </div>

        {/* Spine node */}
        <div className="flex-shrink-0 z-10">
          <div className="w-4 h-4 rounded-full bg-white border-2 border-gray-400 shadow-sm
                          transition-colors duration-300 hover:border-blue-400" />
        </div>

        {/* Right half */}
        <div className="flex-1 flex justify-start pl-5">
          {!isLeft ? (
            <Card />
          ) : (
            <span className="text-xs text-gray-400 font-light tracking-wide tabular-nums select-none">
              {date}
            </span>
          )}
        </div>
      </div>
    </>
  );
}

export default BlogPost;
