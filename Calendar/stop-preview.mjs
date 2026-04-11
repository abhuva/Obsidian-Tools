import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PID_FILE = path.resolve(__dirname, "calendar.preview.pid");
const PORT = Number(process.env.CALENDAR_PORT || 4173);

/**
 * Read Pid From File.
 * @returns {*} Returns pid from file.
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
 * Kill Pid.
 * @param {*}
 * @returns {*} Returns the function result.
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
 * Clear Pid File.
 * @returns {*} Returns the function result.
 */
function clearPidFile() {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch {
    // ignore
  }
}

/**
 * List Listener Processes On Port.
 * @param {*}
 * @returns {*} Returns the function result.
 */
function listListenerProcessesOnPort(port) {
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
 * Looks Like Calendar Server Process.
 * @param {*}
 * @returns {*} Returns the function result.
 */
function looksLikeCalendarServerProcess(proc) {
  const name = String(proc?.name || "").toLowerCase();
  const commandLine = String(proc?.commandLine || "").toLowerCase();
  if (name !== "node.exe" && name !== "node") return false;
  return commandLine.includes("tools\\calendar\\serve.mjs") || commandLine.includes("tools/calendar/serve.mjs");
}

/**
 * Stop Legacy Calendar By Port.
 * @returns {*} Returns the function result.
 */
function stopLegacyCalendarByPort() {
  const listeners = listListenerProcessesOnPort(PORT);
  const candidates = listeners.filter(looksLikeCalendarServerProcess);
  if (!candidates.length) return { stopped: 0, found: listeners.length };
  let stopped = 0;
  for (const proc of candidates) {
    if (killPid(Number(proc.pid))) stopped += 1;
  }
  return { stopped, found: listeners.length, candidates: candidates.map((p) => p.pid) };
}

const pid = readPidFromFile();

if (!pid) {
  const result = stopLegacyCalendarByPort();
  if (result.stopped > 0) {
    console.log(
      `Stopped ${result.stopped} legacy calendar process(es) on port ${PORT} (pid: ${result.candidates.join(", ")}).`
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


