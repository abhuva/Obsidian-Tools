import { execSync } from "node:child_process";

const port = Number(process.env.CALENDAR_PORT || 4173);

function listPidsOnPort(targetPort) {
  try {
    const cmd = `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${targetPort} -State Listen | Select-Object -ExpandProperty OwningProcess"`;
    const output = execSync(cmd, { encoding: "utf8", stdio: "pipe" }).trim();
    if (!output) return [];
    return [...new Set(output.split(/\r?\n/).map((x) => x.trim()).filter(Boolean))].map(Number);
  } catch {
    return [];
  }
}

function killPid(pid) {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

const pids = listPidsOnPort(port);

if (pids.length === 0) {
  console.log(`No listening process found on port ${port}.`);
  process.exit(0);
}

let killed = 0;
for (const pid of pids) {
  if (killPid(pid)) killed += 1;
}

console.log(`Stopped ${killed}/${pids.length} process(es) on port ${port}.`);
