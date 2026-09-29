import { selftest } from "../src/lib/scorer.selftest.ts";

try {
  selftest();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
