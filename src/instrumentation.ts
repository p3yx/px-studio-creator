export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runWorkerLoop } = await import("./lib/job-worker");
    // fire-and-forget singleton loop
    runWorkerLoop().catch((e) => console.error("[px-studio-worker] auto-start failed", e));
  }
}
