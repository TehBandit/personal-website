import { parse } from "@babel/parser";

// Read article text from JSX without mounting articles, running hooks, or loading
// their images. This stays in Vite's Node process; browsers receive only text.
export function extractArticleText(source) {
  const ast = parse(source, { sourceType: "module", plugins: ["jsx"] });
  const parts = [];

  function visit(node, insideChildExpression = false) {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXText") {
      parts.push(node.value);
      return;
    }
    if (node.type === "JSXElement" || node.type === "JSXFragment") {
      node.children.forEach((child) => visit(child));
      return;
    }
    if (node.type === "JSXExpressionContainer") {
      visit(node.expression, true);
      return;
    }
    if (insideChildExpression && node.type === "StringLiteral") {
      parts.push(node.value);
      return;
    }
    if (insideChildExpression && node.type === "TemplateLiteral") {
      node.quasis.forEach((quasi) => parts.push(quasi.value.cooked ?? quasi.value.raw));
      node.expressions.forEach((expression) => visit(expression, true));
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (["comments", "leadingComments", "trailingComments", "innerComments", "loc", "extra"].includes(key)) continue;
      if (Array.isArray(value)) value.forEach((child) => visit(child, insideChildExpression));
      else if (value && typeof value === "object") visit(value, insideChildExpression);
    }
  }

  visit(ast);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export default function blogSearchPlugin() {
  return {
    name: "blog-search-text",
    enforce: "pre",
    transform(source, id) {
      const file = id.split("?")[0].replaceAll("\\", "/");
      if (!/\/src\/blogposts\/[^/]+\.jsx$/.test(file)) return null;
      return {
        code: `${source}\nexport const searchText = ${JSON.stringify(extractArticleText(source))};\n`,
        map: null,
      };
    },
  };
}
