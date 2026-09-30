import { adversarialSelftest } from "../src/lib/adversarial.selftest.ts";

try {
  adversarialSelftest();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
