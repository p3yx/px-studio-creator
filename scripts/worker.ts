import { runWorkerLoop } from "../src/lib/job-worker";

runWorkerLoop().catch((e) => {
  console.error("[aniclip-worker] fatal", e);
  process.exit(1);
});
