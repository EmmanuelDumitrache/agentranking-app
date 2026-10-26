import { getJobWorkerBoss, stopJobBoss, type StopJobBossOptions } from "../../jobs/boss";
import { registerApplicationSchedules } from "./register-schedules";
import { registerApplicationWorkers } from "./register-workers";
import { recoverDeferredWork } from "./recover-deferred-work";
let started = false;
export async function startApplicationJobRuntime(): Promise<void> {
  if (started) return;
  const boss = await getJobWorkerBoss();
  try {
    await registerApplicationWorkers(boss);
    await registerApplicationSchedules(boss);
    const recovered = await recoverDeferredWork(boss);
    started = true;
    console.info("[jobs] application pg-boss runtime started", {
      queues: (await boss.getQueues()).length,
      schedules: (await boss.getSchedules()).length,
      recovered,
    });
  } catch (error) {
    await stopJobBoss().catch((cleanupError) => {
      console.error("[jobs] application runtime startup cleanup failed", cleanupError);
    });
    throw error;
  }
}
export async function stopApplicationJobRuntime(
  options: StopJobBossOptions = {},
): Promise<void> {
  started = false;
  await stopJobBoss(options);
}
