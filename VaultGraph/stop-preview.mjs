import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PID_FILE = path.resolve(__dirname, "vault-graph.preview.pid");
const PORT = Number(process.env.VAULTGRAPH_PORT || 4175);

/**
 * Reads the preview process id from disk.
 * @returns {number} Positive process id or `0` when unavailable.
 */
function readPidFromFile() {
  try {
    if (!fs.existsSync(PID_FILE)) return 0;
    const raw = String(fs.readFileSync(PID_FILE, "utf8") || "").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch {
    return 0;
  }
}

/**
 * Stops a process by id.
 * @param {number} pid - Process id to stop.
 * @returns {boolean} True when the signal was sent.
 */
function killPid(pid) {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes the preview PID file.
 * @returns {void}
 */
function clearPidFile() {
  try {
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  } catch {
    // Ignore cleanup failures.
  }
}

/**
 * Lists Windows listener processes on the configured preview port.
 * @param {number} port - TCP port to inspect.
 * @returns {Array<object>} Listener process objects.
 */
function listListenerProcessesOnPort(port) {
  if (process.platform !== "win32") return [];
  try {
    const ps = [
      "$ErrorActionPreference='Stop';",
      `$pids = Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -ExpandProperty OwningProcess -Unique;`,
      "$items = @();",
      "foreach ($pid in $pids) {",
      "  $proc = Get-CimInstance Win32_Process -Filter \"ProcessId = $pid\";",
      "  if ($proc) {",
      "    $items += [PSCustomObject]@{",
      "      pid = [int]$proc.ProcessId;",
      "      name = [string]$proc.Name;",
      "      commandLine = [string]$proc.CommandLine",
      "    };",
      "  }",
      "}",
      "$items | ConvertTo-Json -Compress"
    ].join(" ");
    const raw = execSync(`powershell -NoProfile -Command "${ps}"`, {
      encoding: "utf8",
      stdio: "pipe"
    }).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/**
 * Checks whether a listener appears to be the VaultGraph server.
 * @param {object} proc - Listener process object.
 * @returns {boolean} True when the process command line points to this server.
 */
function looksLikeVaultGraphServerProcess(proc) {
  const name = String(proc?.name || "").toLowerCase();
  const commandLine = String(proc?.commandLine || "").toLowerCase();
  if (name !== "node.exe" && name !== "node") return false;
  return commandLine.includes("tools\\vaultgraph\\serve.mjs") || commandLine.includes("tools/vaultgraph/serve.mjs");
}

/**
 * Stops legacy VaultGraph servers by port when no PID file is available.
 * @returns {{stopped: number, found: number, candidates?: Array<number>}} Stop result.
 */
function stopLegacyVaultGraphByPort() {
  const listeners = listListenerProcessesOnPort(PORT);
  const candidates = listeners.filter(looksLikeVaultGraphServerProcess);
  if (!candidates.length) return { stopped: 0, found: listeners.length };
  let stopped = 0;
  for (const proc of candidates) {
    if (killPid(Number(proc.pid))) stopped += 1;
  }
  return { stopped, found: listeners.length, candidates: candidates.map((proc) => proc.pid) };
}

const pid = readPidFromFile();

if (!pid) {
  const result = stopLegacyVaultGraphByPort();
  if (result.stopped > 0) {
    console.log(
      `Stopped ${result.stopped} legacy VaultGraph process(es) on port ${PORT} (pid: ${result.candidates.join(", ")}).`
    );
  } else {
    console.log("No preview PID file found.");
  }
  process.exit(0);
}

const killed = killPid(pid);
if (killed) {
  clearPidFile();
  console.log(`Stopped preview process ${pid}.`);
} else {
  clearPidFile();
  console.log(`Preview PID ${pid} was not running.`);
}
