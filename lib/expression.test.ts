import { describe, expect, it } from "vitest";
import { evaluateExpression, isValidExpression } from "./expression";

const value = (input: string, x: number) => {
  const result = evaluateExpression(input, x);
  return result.ok ? result.value : result.error;
};

describe("evaluateExpression", () => {
  it("returns x itself when there is no arithmetic to do", () => {
    expect(value("", 1_500)).toBe(1_500);
    expect(value("   ", 1_500)).toBe(1_500);
    expect(value("x", 1_500)).toBe(1_500);
    expect(value("X", 1_500)).toBe(1_500);
  });

  it("evaluates the screenshot's formula", () => {
    // (x + 1,150,000,000 - 310,000,000 + 300,000,000) / 2
    expect(value("(x+1150000000-310000000+300000000)/2", 400_000_000)).toBe(770_000_000);
  });

  it("gives multiplication and division precedence over addition", () => {
    expect(value("1+2*3", 0)).toBe(7);
    expect(value("(1+2)*3", 0)).toBe(9);
    expect(value("100-40/2", 0)).toBe(80);
  });

  it("handles unary signs, including a doubled one", () => {
    expect(value("-x", 5)).toBe(-5);
    expect(value("--x", 5)).toBe(5);
    expect(value("3*-2", 0)).toBe(-6);
    expect(value("-(x+1)", 5)).toBe(-6);
  });

  it("reads decimals and thousands separators, because that is how the amounts are written", () => {
    expect(value("x*1.5", 100)).toBe(150);
    expect(value("x+.5", 1)).toBe(1.5);
    expect(value("x+1,150,000", 0)).toBe(1_150_000);
  });

  it("nests parentheses", () => {
    expect(value("((x+1)*(x-1))", 3)).toBe(8);
  });

  // The whole reason this is a parser and not `eval`: the expression is
  // stored text that gets evaluated on a report.
  it("refuses anything that is not arithmetic over x", () => {
    for (const attempt of [
      "process.exit(1)",
      "globalThis",
      "x; drop table formulas",
      "fetch('/')",
      "x ** 2",
      "[1,2]",
    ]) {
      expect(isValidExpression(attempt), attempt).toBe(false);
    }
  });

  it("names the unknown identifier rather than reporting a syntax error", () => {
    expect(value("x+y", 1)).toEqual({ kind: "unknownName", name: "y" });
  });

  it("rejects half-written expressions instead of evaluating the half", () => {
    expect(value("x+", 1)).toMatchObject({ kind: "syntax" });
    expect(value("(x", 1)).toMatchObject({ kind: "syntax" });
    expect(value("x)", 1)).toMatchObject({ kind: "syntax" });
    expect(value("x 5", 1)).toMatchObject({ kind: "syntax" });
    expect(value("*x", 1)).toMatchObject({ kind: "syntax" });
    expect(value("x/", 1)).toMatchObject({ kind: "syntax" });
  });

  it("reports a division by zero rather than handing back NaN or Infinity", () => {
    expect(value("x/0", 5)).toEqual({ kind: "notFinite" });
    expect(value("0/0", 5)).toEqual({ kind: "notFinite" });
  });
});

describe("isValidExpression", () => {
  it("accepts the forms the editor is meant to take", () => {
    for (const ok of ["", "x", "x/2", "(x+1000)*0.5", "-x", "x + 1,000.5"]) {
      expect(isValidExpression(ok), ok).toBe(true);
    }
  });

  // A formula that divides by zero at *today's* x is still a formula;
  // that failure belongs on the report, not in the save button.
  it("accepts an expression that only fails at some values of x", () => {
    expect(isValidExpression("x/(x-1)")).toBe(true);
  });
});
