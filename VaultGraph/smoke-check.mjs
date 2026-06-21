import fs from "node:fs";
import { GENERATED_JSON_FILE, GENERATED_JS_FILE } from "./build-graph.mjs";

/**
 * Exits the smoke check with a clear failure message.
 * @param {string} message - Failure reason.
 * @returns {never} Never returns.
 */
function fail(message) {
  console.error(`VaultGraph smoke check failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(GENERATED_JSON_FILE)) {
  fail("graph.generated.json does not exist");
}

if (!fs.existsSync(GENERATED_JS_FILE)) {
  fail("graph.generated.js does not exist");
}

let graph = {};
try {
  graph = JSON.parse(fs.readFileSync(GENERATED_JSON_FILE, "utf8"));
} catch (error) {
  fail(`graph.generated.json is not valid JSON (${error.message})`);
}

if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
  fail("graph nodes are missing or empty");
}

if (!Array.isArray(graph.edges)) {
  fail("graph edges are missing");
}

const nodeIds = new Set();
for (const node of graph.nodes) {
  const id = String(node?.id || "").trim();
  if (!id) fail("found node without id");
  if (nodeIds.has(id)) fail(`duplicate node id detected: ${id}`);
  nodeIds.add(id);
  if (!Number.isInteger(node.depth) || node.depth < 0) fail(`node has invalid depth: ${id}`);
}

for (const edge of graph.edges) {
  if (!nodeIds.has(edge?.source)) fail(`edge source does not exist: ${edge?.source}`);
  if (!nodeIds.has(edge?.target)) fail(`edge target does not exist: ${edge?.target}`);
}

const jsRaw = fs.readFileSync(GENERATED_JS_FILE, "utf8");
if (!jsRaw.startsWith("window.VAULT_GRAPH_DATA = ")) {
  fail("graph.generated.js has unexpected format");
}

console.log(
  `VaultGraph smoke check OK: ${graph.nodes.length} folders, ${graph.edges.length} edges, ${graph.stats?.ignoredCount || 0} ignored`
);
