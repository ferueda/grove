import { lock } from 'proper-lockfile';
import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';

const args = process.argv.slice(2);
if (args.length === 0) {
  process.exit(0);
}

const command = args[0];

if (command === 'lock-probe') {
  const groveDir = args[1];
  await mkdir(groveDir, { recursive: true });
  const lockTarget = join(groveDir, 'grove-state.lock');
  await writeFile(lockTarget, '', { flag: 'a' });
  
  try {
    await lock(lockTarget);
    console.log('lock-probe running');
    // keep alive until killed
    setInterval(() => {}, 1000);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
} else if (command === 'acquire-during-hook') {
  console.log('acquire-during-hook running');
  setTimeout(() => {}, 1000);
} else if (command === 'supersede-destroy') {
  console.log('supersede-destroy running');
  setTimeout(() => {}, 1000);
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
