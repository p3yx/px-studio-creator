#!/usr/bin/env node
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const appRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

// Supports: px studio start|dev|build|worker  OR  px start|dev|build|worker
let cmdArgs = args;
if (args[0] === "studio") cmdArgs = args.slice(1);
const cmd = cmdArgs[0];

const usage = () => {
  console.log("PX STUDIO CLI");
  console.log("");
  console.log("Usage:");
  console.log("  px studio start   Start production server (requires build)");
  console.log("  px studio dev     Start development server");
  console.log("  px studio build   Build for production");
  console.log("  px studio worker  Run background worker only");
  console.log("");
  console.log("Run this after installing/linking the app globally (npm link / npm i -g .).");
};

if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
  usage();
  process.exit(cmd ? 0 : 1);
}

const map = {
  start: { npm: "start" },
  dev: { npm: "dev" },
  build: { npm: "build" },
  worker: { npm: "worker" },
};

const target = map[cmd];
if (!target) {
  console.error(`Unknown command: ${cmd}`);
  console.error("");
  usage();
  process.exit(1);
}

if (!fs.existsSync(path.join(appRoot, "package.json"))) {
  console.error("PX STUDIO app root not found:", appRoot);
  process.exit(1);
}

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCmd, ["run", target.npm], {
  cwd: appRoot,
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

if (result.error) {
  console.error("Failed to run command:", result.error.message);
  process.exit(1);
}
process.exit(typeof result.status === "number" ? result.status : 1);
