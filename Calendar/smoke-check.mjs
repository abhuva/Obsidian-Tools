import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVENTS_FILE = path.resolve(__dirname, "events.generated.js");

function fail(message) {
  console.error(`Smoke check failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(EVENTS_FILE)) {
  fail("events.generated.js does not exist");
}

const raw = fs.readFileSync(EVENTS_FILE, "utf8");
const prefix = "window.CALENDAR_EVENTS = ";
if (!raw.startsWith(prefix)) {
  fail("events.generated.js has unexpected format");
}

let events = [];
try {
  const json = raw.slice(prefix.length).trim().replace(/;$/, "");
  events = JSON.parse(json);
} catch (error) {
  fail(`events.generated.js is not valid JSON payload (${error.message})`);
}

if (!Array.isArray(events)) {
  fail("events payload is not an array");
}

const ids = new Set();
for (const event of events) {
  const id = String(event?.id || "").trim();
  if (!id) fail("found event without id");
  if (ids.has(id)) fail(`duplicate event id detected: ${id}`);
  ids.add(id);

  const start = String(event?.start || event?.rrule?.dtstart || "").trim();
  if (!start) fail(`event ${id} missing start or rrule.dtstart`);
}

const recurringOverrides = events.filter(
  (event) =>
    String(event?.id || "").includes("#rdate-") &&
    event?.allDay === false
);
for (const event of recurringOverrides) {
  if (!event.end && !(event.duration && Number(event.duration.milliseconds) > 0)) {
    fail(`timed recurring override missing end/duration: ${event.id}`);
  }
}

console.log(`Smoke check OK: ${events.length} events`);
