// Static shape check for a SQL file: parentheses, string literals and dollar quotes.
import { readFileSync } from "node:fs";

const files = process.argv.slice(2);

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const problems = [];
  let depth = 0;
  let i = 0;
  let line = 1;
  let quote = null;
  let dollar = null;

  while (i < source.length) {
    const c = source[i];
    if (c === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (quote) {
      if (c === quote) {
        if (quote === "'" && source[i + 1] === "'") {
          i += 2;
          continue;
        }
        quote = null;
      }
      i += 1;
      continue;
    }
    if (dollar) {
      if (source.startsWith(dollar, i)) {
        i += dollar.length;
        dollar = null;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === "-" && source[i + 1] === "-") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      i += 1;
      continue;
    }
    if (c === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(source.slice(i));
      if (tag) {
        dollar = tag[0];
        i += dollar.length;
        continue;
      }
    }
    if (c === "(") {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === ")") {
      depth -= 1;
      if (depth < 0) {
        problems.push(`line ${line}: unbalanced )`);
        depth = 0;
      }
      i += 1;
      continue;
    }
    i += 1;
  }

  if (depth !== 0) problems.push(`unclosed parens, depth ${depth}`);
  if (quote) problems.push(`unterminated string ${quote}`);
  if (dollar) problems.push(`unclosed dollar quote ${dollar}`);

  console.log(file, problems.length ? problems.join("; ") : "shape OK");
}
