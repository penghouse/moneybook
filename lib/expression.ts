/**
 * The little arithmetic language the 계산식 editor accepts: numbers, the
 * variable `x`, `+ - * /`, and parentheses.
 *
 * Hand-written rather than `eval` or `new Function`, and that is not
 * paranoia about this one user: the expression is stored in the database
 * and rendered on a report, so evaluating it is a code path that turns
 * *stored text* into *executed code*. A parser that only knows four
 * operators cannot be talked into anything else, however the text got
 * there.
 *
 * Deliberately small. No exponentiation (`2^32` is not a thing anyone
 * budgets with), no functions, no comparison — every one of those is a
 * new question about precedence and a new thing to explain in the
 * editor's help text.
 *
 * Numbers are read in the base currency's *major* units — the amounts on
 * screen — so "x-310000000" means what it looks like it means. The
 * caller converts.
 */

export type ExpressionError =
  { kind: "syntax"; at: number } | { kind: "unknownName"; name: string } | { kind: "notFinite" };

export type ExpressionResult = { ok: true; value: number } | { ok: false; error: ExpressionError };

type Token =
  | { type: "number"; value: number; at: number }
  | { type: "name"; value: string; at: number }
  | { type: "op"; value: "+" | "-" | "*" | "/"; at: number }
  | { type: "paren"; value: "(" | ")"; at: number };

const OPERATORS = new Set(["+", "-", "*", "/"]);

function tokenize(input: string): Token[] | { at: number } {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const c = input[i];
    if (c === " " || c === "\t" || c === "\n") {
      i += 1;
      continue;
    }
    // Thousands separators are how the amounts are written everywhere
    // else on these screens, so pasting one in has to work.
    if (c === ",") {
      i += 1;
      continue;
    }
    if (OPERATORS.has(c)) {
      tokens.push({ type: "op", value: c as "+" | "-" | "*" | "/", at: i });
      i += 1;
      continue;
    }
    if (c === "(" || c === ")") {
      tokens.push({ type: "paren", value: c, at: i });
      i += 1;
      continue;
    }
    if (c >= "0" && c <= "9") {
      const start = i;
      while (i < input.length && ((input[i] >= "0" && input[i] <= "9") || input[i] === ",")) i += 1;
      if (input[i] === ".") {
        i += 1;
        while (i < input.length && input[i] >= "0" && input[i] <= "9") i += 1;
      }
      const value = Number(input.slice(start, i).replace(/,/g, ""));
      if (!Number.isFinite(value)) return { at: start };
      tokens.push({ type: "number", value, at: start });
      continue;
    }
    // A bare `.` starting a number, so ".5" is not a syntax error.
    if (c === ".") {
      const start = i;
      i += 1;
      while (i < input.length && input[i] >= "0" && input[i] <= "9") i += 1;
      if (i === start + 1) return { at: start };
      tokens.push({ type: "number", value: Number(input.slice(start, i)), at: start });
      continue;
    }
    if (/[\p{L}_]/u.test(c)) {
      const start = i;
      while (i < input.length && /[\p{L}\p{N}_]/u.test(input[i])) i += 1;
      tokens.push({ type: "name", value: input.slice(start, i), at: start });
      continue;
    }
    return { at: i };
  }

  return tokens;
}

/**
 * Evaluate `input` with `x` bound to `x`.
 *
 * An empty expression is `x` itself: the editor's field is optional, and
 * "no arithmetic" is by far the common case.
 */
export function evaluateExpression(input: string, x: number): ExpressionResult {
  const source = input.trim();
  if (source === "") return { ok: true, value: x };

  const tokens = tokenize(source);
  if (!Array.isArray(tokens)) return { ok: false, error: { kind: "syntax", at: tokens.at } };
  if (tokens.length === 0) return { ok: true, value: x };

  let pos = 0;
  let failure: ExpressionError | null = null;

  const fail = (error: ExpressionError): number => {
    failure ??= error;
    return 0;
  };
  const peek = () => tokens[pos];

  // expression := term (('+' | '-') term)*
  function parseExpression(): number {
    let value = parseTerm();
    for (;;) {
      const token = peek();
      if (
        failure ||
        !token ||
        token.type !== "op" ||
        (token.value !== "+" && token.value !== "-")
      ) {
        return value;
      }
      pos += 1;
      const right = parseTerm();
      value = token.value === "+" ? value + right : value - right;
    }
  }

  // term := unary (('*' | '/') unary)*
  function parseTerm(): number {
    let value = parseUnary();
    for (;;) {
      const token = peek();
      if (
        failure ||
        !token ||
        token.type !== "op" ||
        (token.value !== "*" && token.value !== "/")
      ) {
        return value;
      }
      pos += 1;
      const right = parseUnary();
      value = token.value === "*" ? value * right : value / right;
    }
  }

  // unary := ('+' | '-') unary | primary
  function parseUnary(): number {
    const token = peek();
    if (token && token.type === "op" && (token.value === "+" || token.value === "-")) {
      pos += 1;
      const value = parseUnary();
      return token.value === "-" ? -value : value;
    }
    return parsePrimary();
  }

  // primary := number | name | '(' expression ')'
  function parsePrimary(): number {
    const token = peek();
    if (!token) return fail({ kind: "syntax", at: source.length });
    if (token.type === "number") {
      pos += 1;
      return token.value;
    }
    if (token.type === "name") {
      pos += 1;
      // Case-insensitive so a capitalised X is not a mystery error.
      if (token.value.toLowerCase() === "x") return x;
      return fail({ kind: "unknownName", name: token.value });
    }
    if (token.type === "paren" && token.value === "(") {
      pos += 1;
      const value = parseExpression();
      const close = peek();
      if (!close || close.type !== "paren" || close.value !== ")") {
        return fail({ kind: "syntax", at: close?.at ?? source.length });
      }
      pos += 1;
      return value;
    }
    return fail({ kind: "syntax", at: token.at });
  }

  const value = parseExpression();
  if (failure) return { ok: false, error: failure };
  // Trailing junk — "x 5" or "(x))" — is a mistake, not something to
  // quietly ignore half of.
  if (pos < tokens.length) return { ok: false, error: { kind: "syntax", at: tokens[pos].at } };
  // Division by zero is the one that actually happens, and rendering
  // "₩NaN" on a report is worse than saying the formula is broken.
  if (!Number.isFinite(value)) return { ok: false, error: { kind: "notFinite" } };

  return { ok: true, value };
}

/**
 * Whether the expression is *writable* — parses, and names nothing but
 * `x`.
 *
 * Not the same as evaluating to a number: `x/(x-1)` is a perfectly good
 * formula that happens to divide by zero at one value of x, and
 * refusing to save it would be refusing it for today's balance. That
 * failure belongs on the report, where it is about the number.
 */
export function isValidExpression(input: string): boolean {
  const result = evaluateExpression(input, 1);
  return result.ok || result.error.kind === "notFinite";
}
