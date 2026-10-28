// SPDX-License-Identifier: MIT
export function createChildShutdown(child, {graceMs = 1000} = {}) {
  let timer;
  const alive = () => child.exitCode == null && child.signalCode == null;
  const clear = () => clearTimeout(timer);
  child.once("close", clear);
  return {
    terminate(signal = "SIGTERM") {
      if (!alive()) return;
      child.kill(signal);
      this.afterInputClosed();
    },
    afterInputClosed() {
      if (timer || !alive()) return;
      timer = setTimeout(() => { if (alive()) child.kill("SIGKILL"); }, graceMs);
      timer.unref();
    },
    dispose() { clear(); child.removeListener("close", clear); },
  };
}
