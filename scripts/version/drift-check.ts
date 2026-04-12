import {
  collectVersionDrift,
  readVersion,
} from "../lib/release";

const version = readVersion();
const mismatches = collectVersionDrift(version);

const result = {
  success: mismatches.length === 0,
  message: mismatches.length === 0
    ? "Version drift check passed."
    : "Version drift detected.",
  data: {
    version,
    mismatches,
  },
};

console.log(JSON.stringify(result));
if (!result.success) {
  process.exit(1);
}
