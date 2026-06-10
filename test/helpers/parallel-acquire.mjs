import { createGrove } from "../../dist/index.js";

const repoRoot = process.env.GROVE_TEST_REPO;
const groveDir = process.env.GROVE_TEST_DIR;

async function main() {
  try {
    const grove = await createGrove({ repoRoot, groveDir });
    const wt = await grove.acquire();
    console.log(wt);
    setInterval(() => {}, 1000000);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
