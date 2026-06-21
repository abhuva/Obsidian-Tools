import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const TOOL_ROOT = __dirname;
export const VAULT_ROOT = path.resolve(__dirname, "..", "..");
export const GENERATED_JSON_FILE = path.resolve(TOOL_ROOT, "graph.generated.json");
export const GENERATED_JS_FILE = path.resolve(TOOL_ROOT, "graph.generated.js");

const ROOT_ID = ".";
const HIDDEN_SYSTEM_ROOTS = new Set([".git"]);
const SYSTEM_ROOTS = new Set([".obsidian", "Tools"]);

/**
 * Converts a path to stable slash-separated vault-relative form.
 * @param {string} absolutePath - Absolute path inside the vault.
 * @returns {string} Vault-relative path or `.` for the vault root.
 */
export function toVaultRelativePath(absolutePath) {
  const relative = path.relative(VAULT_ROOT, absolutePath).replace(/\\/g, "/");
  return relative || ROOT_ID;
}

/**
 * Returns whether a path segment is a hidden/system-style folder.
 * @param {string} segment - Single path segment.
 * @returns {boolean} True when the segment starts with a dot.
 */
function isHiddenSegment(segment) {
  return segment.startsWith(".");
}

/**
 * Returns whether a folder should be skipped during scanning.
 * @param {string} relativePath - Vault-relative folder path.
 * @returns {boolean} True when the folder should not be scanned.
 */
export function shouldIgnoreFolder(relativePath) {
  if (!relativePath || relativePath === ROOT_ID) return false;
  const normalized = relativePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  const name = segments.at(-1) || "";

  if (HIDDEN_SYSTEM_ROOTS.has(segments[0])) return true;
  if (segments.includes("node_modules")) return true;
  if (name === "vault-graph.preview.pid") return true;
  if (name.endsWith(".log")) return true;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (normalized === ".obsidian/cache" || normalized.startsWith(".obsidian/cache/")) return true;
  if (segments[0] === ".obsidian" && /^workspace/.test(name)) return true;

  return false;
}

/**
 * Returns whether a folder is considered a system folder for default UI filtering.
 * @param {string} relativePath - Vault-relative folder path.
 * @returns {boolean} True when the folder is a system/tool folder.
 */
function isSystemFolder(relativePath) {
  if (!relativePath || relativePath === ROOT_ID) return false;
  const segments = relativePath.split("/").filter(Boolean);
  return SYSTEM_ROOTS.has(segments[0]) || segments.some(isHiddenSegment);
}

/**
 * Reads direct child entries safely and records scan errors.
 * @param {string} absolutePath - Absolute folder path to inspect.
 * @param {Array<object>} errors - Mutable error collection.
 * @returns {Array<import("node:fs").Dirent>} Direct child entries.
 */
function readChildEntries(absolutePath, errors) {
  try {
    return fs.readdirSync(absolutePath, { withFileTypes: true });
  } catch (error) {
    errors.push({
      path: toVaultRelativePath(absolutePath),
      message: String(error?.message || error)
    });
    return [];
  }
}

/**
 * Reads direct child directories safely and records scan errors.
 * @param {string} absolutePath - Absolute folder path to inspect.
 * @param {Array<object>} errors - Mutable error collection.
 * @returns {Array<{absolutePath: string, name: string}>} Direct child directories.
 */
function readChildDirectories(absolutePath, errors) {
  const entries = readChildEntries(absolutePath, errors);

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      absolutePath: path.join(absolutePath, entry.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
}

/**
 * Sums direct file sizes below a folder.
 * @param {string} absolutePath - Absolute folder path to inspect.
 * @param {Array<object>} errors - Mutable scan-error collection.
 * @returns {{bytes: number, files: number}} Direct file size summary.
 */
function readDirectFileSize(absolutePath, errors) {
  const entries = readChildEntries(absolutePath, errors);
  let bytes = 0;
  let files = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(absolutePath, entry.name);
    try {
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink()) continue;
      bytes += stat.size;
      files += 1;
    } catch (error) {
      errors.push({
        path: toVaultRelativePath(filePath),
        message: String(error?.message || error)
      });
    }
  }

  return { bytes, files };
}

/**
 * Scans one folder recursively and appends graph nodes and edges.
 * @param {object} context - Mutable scan context.
 * @param {string} context.absolutePath - Absolute path to scan.
 * @param {string} context.parentId - Parent graph node id.
 * @param {number} context.depth - Current folder depth.
 * @param {Array<object>} context.nodes - Mutable node collection.
 * @param {Array<object>} context.edges - Mutable edge collection.
 * @param {Array<object>} context.ignored - Mutable ignored-folder collection.
 * @param {Array<object>} context.errors - Mutable scan-error collection.
 * @returns {{descendantFolderCount: number, totalFileBytes: number, totalFileCount: number}} Descendant summary for this folder.
 */
function scanFolder(context) {
  const relativePath = toVaultRelativePath(context.absolutePath);
  const nodeId = relativePath;
  const nodeName = relativePath === ROOT_ID ? path.basename(VAULT_ROOT) : path.basename(context.absolutePath);
  const children = [];

  for (const child of readChildDirectories(context.absolutePath, context.errors)) {
    const childRelativePath = toVaultRelativePath(child.absolutePath);
    if (shouldIgnoreFolder(childRelativePath)) {
      context.ignored.push({ path: childRelativePath, reason: "default ignore rule" });
      continue;
    }

    let stat;
    try {
      stat = fs.lstatSync(child.absolutePath);
    } catch (error) {
      context.errors.push({
        path: childRelativePath,
        message: String(error?.message || error)
      });
      continue;
    }

    if (stat.isSymbolicLink()) {
      context.ignored.push({ path: childRelativePath, reason: "symlink" });
      continue;
    }

    children.push(child);
  }

  const directFiles = readDirectFileSize(context.absolutePath, context.errors);
  const node = {
    id: nodeId,
    name: nodeName,
    path: relativePath,
    parentPath: context.parentId,
    depth: context.depth,
    directFolderCount: children.length,
    descendantFolderCount: 0,
    directFileBytes: directFiles.bytes,
    totalFileBytes: directFiles.bytes,
    directFileCount: directFiles.files,
    totalFileCount: directFiles.files,
    system: isSystemFolder(relativePath),
    topLevel: relativePath === ROOT_ID ? ROOT_ID : relativePath.split("/")[0]
  };
  context.nodes.push(node);

  if (context.parentId) {
    context.edges.push({ source: context.parentId, target: nodeId });
  }

  let descendantFolderCount = 0;
  let totalFileBytes = directFiles.bytes;
  let totalFileCount = directFiles.files;
  for (const child of children) {
    const childSummary = scanFolder({
      ...context,
      absolutePath: child.absolutePath,
      parentId: nodeId,
      depth: context.depth + 1
    });
    descendantFolderCount += 1 + childSummary.descendantFolderCount;
    totalFileBytes += childSummary.totalFileBytes;
    totalFileCount += childSummary.totalFileCount;
  }

  node.descendantFolderCount = descendantFolderCount;
  node.totalFileBytes = totalFileBytes;
  node.totalFileCount = totalFileCount;
  return { descendantFolderCount, totalFileBytes, totalFileCount };
}

/**
 * Builds a complete graph payload for the current vault folder hierarchy.
 * @returns {object} Graph payload with nodes, edges, stats, ignored folders, and errors.
 */
export function buildGraphPayload() {
  const nodes = [];
  const edges = [];
  const ignored = [];
  const errors = [];
  const startedAtMs = Date.now();

  scanFolder({
    absolutePath: VAULT_ROOT,
    parentId: "",
    depth: 0,
    nodes,
    edges,
    ignored,
    errors
  });

  const maxDepth = nodes.reduce((max, node) => Math.max(max, Number(node.depth || 0)), 0);
  const totalFileBytes = nodes.find((node) => node.id === ROOT_ID)?.totalFileBytes || 0;
  const totalFileCount = nodes.find((node) => node.id === ROOT_ID)?.totalFileCount || 0;
  const topLevelFolders = nodes
    .filter((node) => node.depth === 1)
    .map((node) => node.path)
    .sort((a, b) => a.localeCompare(b, "de"));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root: path.basename(VAULT_ROOT),
    stats: {
      folderCount: nodes.length,
      edgeCount: edges.length,
      ignoredCount: ignored.length,
      errorCount: errors.length,
      maxDepth,
      totalFileBytes,
      totalFileCount,
      durationMs: Date.now() - startedAtMs
    },
    topLevelFolders,
    nodes,
    edges,
    ignored,
    errors
  };
}

/**
 * Writes generated graph payload files for browser and API usage.
 * @param {object} payload - Graph payload to persist.
 * @returns {{jsonFile: string, jsFile: string}} Generated file paths.
 */
export function writeGraphFiles(payload) {
  const json = JSON.stringify(payload, null, 2);
  fs.writeFileSync(GENERATED_JSON_FILE, `${json}\n`, "utf8");
  fs.writeFileSync(GENERATED_JS_FILE, `window.VAULT_GRAPH_DATA = ${json};\n`, "utf8");
  return {
    jsonFile: GENERATED_JSON_FILE,
    jsFile: GENERATED_JS_FILE
  };
}

/**
 * Builds and writes graph files.
 * @returns {object} Generated graph payload.
 */
export function buildAndWriteGraph() {
  const payload = buildGraphPayload();
  writeGraphFiles(payload);
  return payload;
}

/**
 * Runs the build when this module is executed directly.
 * @returns {void}
 */
function main() {
  const payload = buildAndWriteGraph();
  console.log(
    `VaultGraph build OK: ${payload.stats.folderCount} folders, ${payload.stats.edgeCount} edges, ${payload.stats.totalFileBytes} bytes, ${payload.stats.ignoredCount} ignored, ${payload.stats.errorCount} errors`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
