import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const cliVersion: string = require("../package.json").version;
