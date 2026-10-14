import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const KEY_PATTERNS = [/\bsk-[A-Za-z0-9_-]{16,}/, /gsk_[A-Za-z0-9]{10,}/, /\bBearer\s+[A-Za-z0-9._-]{10,}/, /x-api-key/i, /authorization"\s*:/i];

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe("secret scan (NFR-2)", () => {
  it("cassettes contain no keys or auth headers", () => {
    for (const f of files("cassettes")) {
      const text = readFileSync(f, "utf8");
      for (const re of KEY_PATTERNS) expect(re.test(text), `${f} matches ${re}`).toBe(false);
    }
  });
});
