#!/usr/bin/env node
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const appRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

// Supports: px studio start|dev|build|worker|install  OR  px start|dev|build|worker|install
let cmdArgs = args;
if (args[0] === "studio") cmdArgs = args.slice(1);
const cmd = cmdArgs[0];

const usage = () => {
  console.log("PX STUDIO CLI");
  console.log("");
  console.log("Usage:");
  console.log("  px studio start    Start production server (requires build)");
  console.log("  px studio dev      Start development server");
  console.log("  px studio build    Build for production");
  console.log("  px studio worker   Run background worker only");
  console.log("  px studio install  Install app to user folder and enable global command");
  console.log("  px studio where    Show installed app location");
  console.log("");
  console.log("Run 'px studio install' once from the source folder to set up for this user.");
};

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (command, commandArgs, cwd, extraEnv) => {
  const r = spawnSync(command, commandArgs, {
    cwd: cwd || appRoot,
    stdio: "inherit",
    env: { ...process.env, ...(extraEnv || {}) },
    shell: process.platform === "win32",
  });
  if (r.error) {
    console.error("Failed to run:", command, commandArgs.join(" "), "-", r.error.message);
    process.exit(1);
  }
  if (typeof r.status === "number" && r.status !== 0) process.exit(r.status);
  return r;
};

const copyDir = (src, dest) => {
  const skip = new Set([".git", "node_modules", ".next"]);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      // skip storage contents except keep dir? copy structure; for simplicity skip large runtime storage
      if (entry.name === "storage") {
        fs.mkdirSync(d, { recursive: true });
        continue;
      }
      copyDir(s, d);
    } else if (entry.isSymbolicLink()) {
      // ignore symlinks
    } else {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
  }
};

const doInstall = () => {
  const targetDir = path.join(os.homedir(), "px-studio");
  console.log("PX STUDIO - User install");
  console.log("Source:", appRoot);
  console.log("Target:", targetDir);
  console.log("");
  if (path.resolve(appRoot).toLowerCase() === path.resolve(targetDir).toLowerCase()) {
    console.log("Already running from target install directory. Running setup/link...");
  } else {
    console.log("Copying app files to user folder...");
    fs.mkdirSync(targetDir, { recursive: true });
    copyDir(appRoot, targetDir);
    console.log("Copy complete.");
  }
  console.log("");
  console.log("Installing dependencies...");
  run(npmCmd, ["install"], targetDir);
  console.log("");
  console.log("Generating Prisma client...");
  run(npmCmd, ["run", "db:generate"], targetDir);
  console.log("");
  console.log("Preparing database (db:push)...");
  run(npmCmd, ["run", "db:push"], targetDir);
  console.log("");
  console.log("Building app...");
  run(npmCmd, ["run", "build"], targetDir);
  console.log("");
  console.log("Linking global command (px)... You may need admin/sudo in some environments.");
  run(npmCmd, ["link"], targetDir);
  console.log("");
  console.log("Done. App installed at:", targetDir);
  console.log("You can now run from any terminal:");
  console.log("  px studio start");
  console.log("  px studio dev");
};

if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
  usage();
  process.exit(cmd ? 0 : 1);
}

if (cmd === "where") {
  console.log(appRoot);
  process.exit(0);
}

if (cmd === "install" || cmd === "setup") {
  doInstall();
  process.exit(0);
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
