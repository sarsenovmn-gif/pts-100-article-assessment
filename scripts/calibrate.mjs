import { runCalibration } from "../src/lib/calibrate.ts";

try {
  runCalibration();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
