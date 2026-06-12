import { createGrove } from "../../dist/index.js";

const leaseIndex = process.argv[2] ?? "0";
const repoRoot = process.env.GROVE_REPO_ROOT;
const groveRoot = process.env.GROVE_GROVE_ROOT;

if (!repoRoot || !groveRoot) {
  console.error("GROVE_REPO_ROOT and GROVE_GROVE_ROOT are required");
  process.exit(1);
}

try {
  const grove = await createGrove({ repoRoot, groveRoot, maxTrees: 8 });
  const lease = await grove.acquire({
    leaseId: `parallel-${leaseIndex}`,
    mode: "detached",
    ref: "main",
  });
  process.stdout.write(lease.path);
} catch (err) {
  console.error(err);
  process.exit(1);
}
