const variantStyles = {
  plain: "border-gray-200 bg-white text-gray-700",
  blue: "border-blue-400 bg-blue-50 text-blue-950",
  violet: "border-violet-400 bg-violet-50 text-violet-950",
  emerald: "border-emerald-400 bg-emerald-50 text-emerald-950",
  amber: "border-amber-400 bg-amber-50 text-amber-950",
};

function GeneratedPost({ blocks = [] }) {
  return (
    <article className="mx-auto max-w-3xl pb-12 text-base leading-8 md:text-lg">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        const variant = variantStyles[block.variant] ?? variantStyles.plain;

        if (block.type === "divider") {
          return <hr key={key} className="my-8 border-gray-300" />;
        }

        if (block.type === "heading") {
          return (
            <h2 key={key} className="mb-3 mt-10 text-xl font-semibold text-gray-900 md:text-2xl">
              {block.text}
            </h2>
          );
        }

        if (block.type === "bullet-list") {
          return (
            <section key={key} className={`my-6 rounded-2xl border p-5 ${variant}`}>
              {block.text && <p className="mb-3 font-semibold">{block.text}</p>}
              <ul className="list-disc space-y-2 pl-6">
                {block.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          );
        }

        if (["callout", "shipped", "in-progress"].includes(block.type)) {
          const label = block.type === "shipped"
            ? "shipped"
            : block.type === "in-progress"
              ? "still in progress"
              : null;
          return (
            <aside key={key} className={`my-6 rounded-r-2xl border-l-4 px-5 py-4 ${variant}`}>
              {label && <p className="mb-1 text-sm font-semibold tracking-wide">{label}</p>}
              <p>{block.text}</p>
            </aside>
          );
        }

        return (
          <p
            key={key}
            className={block.type === "intro" ? "mb-6 text-xl leading-9 text-gray-800" : "mb-5 text-gray-700"}
          >
            {block.text}
          </p>
        );
      })}
    </article>
  );
}

export default GeneratedPost;
