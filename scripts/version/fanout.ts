import {
  getVersionTargets,
  readVersion,
  syncVersionField,
} from "../lib/release";

const version = readVersion();
const updates = getVersionTargets().map((target) => {
  const result = syncVersionField(target.path, version);
  return {
    name: target.name,
    path: target.path,
    changed: result.changed,
    previous: result.previous,
    next: version,
  };
});

console.log(JSON.stringify({
  success: true,
  message: "Version fan-out complete.",
  data: {
    version,
    updates,
  },
}));
