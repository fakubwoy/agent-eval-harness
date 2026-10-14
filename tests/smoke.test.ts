import { describe, expect, it } from "vitest";
import { USAGE } from "../src/cli.js";

describe("cli usage", () => {
  it("lists every command", () => {
    for (const cmd of ["run", "report", "validate", "list"]) expect(USAGE).toMatch(new RegExp(`^  ${cmd} `, "m"));
  });
});
