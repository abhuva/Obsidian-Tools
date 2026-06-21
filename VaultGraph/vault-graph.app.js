const state = {
  graph: window.VAULT_GRAPH_DATA || null,
  chart: null,
  selectedNode: null,
  viewMode: "graph",
  focusRootId: "",
  hiddenSubtreeRoots: new Set()
};

const elements = {
  graph: document.querySelector("#graph"),
  nodeHud: document.querySelector("#nodeHud"),
  graphViewButton: document.querySelector("#graphViewButton"),
  treeViewButton: document.querySelector("#treeViewButton"),
  treemapViewButton: document.querySelector("#treemapViewButton"),
  rebuildButton: document.querySelector("#rebuildButton"),
  statusText: document.querySelector("#statusText"),
  searchInput: document.querySelector("#searchInput"),
  topLevelSelect: document.querySelector("#topLevelSelect"),
  depthInput: document.querySelector("#depthInput"),
  depthValue: document.querySelector("#depthValue"),
  rootToggle: document.querySelector("#rootToggle"),
  systemToggle: document.querySelector("#systemToggle"),
  labelsToggle: document.querySelector("#labelsToggle"),
  nodeScaleInput: document.querySelector("#nodeScaleInput"),
  nodeScaleValue: document.querySelector("#nodeScaleValue"),
  colorModeSelect: document.querySelector("#colorModeSelect"),
  repulsionInput: document.querySelector("#repulsionInput"),
  repulsionValue: document.querySelector("#repulsionValue"),
  edgeMinInput: document.querySelector("#edgeMinInput"),
  edgeMinValue: document.querySelector("#edgeMinValue"),
  edgeMaxInput: document.querySelector("#edgeMaxInput"),
  edgeMaxValue: document.querySelector("#edgeMaxValue"),
  gravityInput: document.querySelector("#gravityInput"),
  gravityValue: document.querySelector("#gravityValue"),
  frictionInput: document.querySelector("#frictionInput"),
  frictionValue: document.querySelector("#frictionValue"),
  lineWidthInput: document.querySelector("#lineWidthInput"),
  lineWidthValue: document.querySelector("#lineWidthValue"),
  treeGapXInput: document.querySelector("#treeGapXInput"),
  treeGapXValue: document.querySelector("#treeGapXValue"),
  treeGapYInput: document.querySelector("#treeGapYInput"),
  treeGapYValue: document.querySelector("#treeGapYValue"),
  treeLabelSpaceInput: document.querySelector("#treeLabelSpaceInput"),
  treeLabelSpaceValue: document.querySelector("#treeLabelSpaceValue"),
  treeAnimationInput: document.querySelector("#treeAnimationInput"),
  treeAnimationValue: document.querySelector("#treeAnimationValue"),
  detailsList: document.querySelector("#detailsList")
};

const tuningControls = [
  ["nodeScaleInput", "nodeScaleValue"],
  ["repulsionInput", "repulsionValue"],
  ["edgeMinInput", "edgeMinValue"],
  ["edgeMaxInput", "edgeMaxValue"],
  ["gravityInput", "gravityValue"],
  ["frictionInput", "frictionValue"],
  ["lineWidthInput", "lineWidthValue"],
  ["treeGapXInput", "treeGapXValue"],
  ["treeGapYInput", "treeGapYValue"],
  ["treeLabelSpaceInput", "treeLabelSpaceValue"],
  ["treeAnimationInput", "treeAnimationValue"]
];

/**
 * Sets the visible status message.
 * @param {string} message - Message to display.
 * @returns {void}
 */
function setStatus(message) {
  elements.statusText.textContent = message;
}

/**
 * Parses a numeric input value with fallback.
 * @param {HTMLInputElement} input - Numeric range input.
 * @param {number} fallback - Fallback number.
 * @returns {number} Parsed finite number.
 */
function readNumberInput(input, fallback) {
  const parsed = Number(input?.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Returns the current filter values from the UI.
 * @returns {{search: string, topLevel: string, maxDepth: number, showRoot: boolean, showSystem: boolean}} Active filters.
 */
function readFilters() {
  return {
    search: String(elements.searchInput.value || "").trim().toLowerCase(),
    topLevel: String(elements.topLevelSelect.value || "").trim(),
    maxDepth: Number(elements.depthInput.value),
    showRoot: elements.rootToggle.checked,
    showSystem: elements.systemToggle.checked
  };
}

/**
 * Returns the current visual graph tuning values.
 * @returns {{showLabels: boolean, nodeScale: number, colorMode: string, repulsion: number, edgeMin: number, edgeMax: number, gravity: number, friction: number, lineWidth: number, treeGapX: number, treeGapY: number, treeLabelSpace: number, treeAnimation: number}} Active render controls.
 */
function readTuning() {
  const edgeMin = readNumberInput(elements.edgeMinInput, 42);
  const edgeMax = readNumberInput(elements.edgeMaxInput, 116);
  return {
    showLabels: elements.labelsToggle.checked,
    nodeScale: readNumberInput(elements.nodeScaleInput, 1),
    colorMode: String(elements.colorModeSelect.value || "depth"),
    repulsion: readNumberInput(elements.repulsionInput, 130),
    edgeMin: Math.min(edgeMin, edgeMax),
    edgeMax: Math.max(edgeMin, edgeMax),
    gravity: readNumberInput(elements.gravityInput, 0.08),
    friction: readNumberInput(elements.frictionInput, 0.86),
    lineWidth: readNumberInput(elements.lineWidthInput, 1),
    treeGapX: readNumberInput(elements.treeGapXInput, 140),
    treeGapY: readNumberInput(elements.treeGapYInput, 18),
    treeLabelSpace: readNumberInput(elements.treeLabelSpaceInput, 180),
    treeAnimation: readNumberInput(elements.treeAnimationInput, 0)
  };
}

/**
 * Mirrors range input values into compact labels.
 * @returns {void}
 */
function updateTuningLabels() {
  for (const [inputKey, valueKey] of tuningControls) {
    elements[valueKey].textContent = elements[inputKey].value;
  }
}

/**
 * Clamps a numeric value to an inclusive range.
 * @param {number} value - Candidate value.
 * @param {number} min - Minimum value.
 * @param {number} max - Maximum value.
 * @returns {number} Clamped value.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Returns whether a graph node represents the vault root.
 * @param {object} node - Candidate graph node.
 * @returns {boolean} True when the node is the synthetic root folder.
 */
function isRootNode(node) {
  return node?.id === "." || node?.path === "." || Number(node?.depth) === 0;
}

/**
 * Builds a node lookup map from graph nodes.
 * @param {Array<object>} nodes - Graph nodes.
 * @returns {Map<string, object>} Node lookup by id.
 */
function buildNodeMap(nodes) {
  return new Map((nodes || []).map((node) => [node.id, node]));
}

/**
 * Returns whether a node is inside a root node's subtree.
 * @param {object} node - Candidate node.
 * @param {string} rootId - Root node id.
 * @param {Map<string, object>} nodeMap - Node lookup by id.
 * @returns {boolean} True when candidate is the root or a descendant.
 */
function isNodeInSubtree(node, rootId, nodeMap) {
  if (!rootId) return false;
  let current = node;
  while (current) {
    if (current.id === rootId) return true;
    current = nodeMap.get(current.parentPath);
  }
  return false;
}

/**
 * Resolves the active root for relative-depth filtering.
 * @param {object} graph - Graph payload.
 * @param {Map<string, object>} nodeMap - Node lookup by id.
 * @returns {object|null} Active root node when available.
 */
function getActiveRootNode(graph, nodeMap) {
  const filters = readFilters();
  if (state.focusRootId && nodeMap.has(state.focusRootId)) return nodeMap.get(state.focusRootId);
  if (filters.topLevel && nodeMap.has(filters.topLevel)) return nodeMap.get(filters.topLevel);
  if (filters.showRoot && nodeMap.has(".")) return nodeMap.get(".");
  return graph.nodes.reduce((lowest, node) => {
    if (!lowest) return node;
    return Number(node.depth || 0) < Number(lowest.depth || 0) ? node : lowest;
  }, null);
}

/**
 * Returns relative depth from the active root.
 * @param {object} node - Node to measure.
 * @param {object|null} activeRoot - Active root node.
 * @param {Map<string, object>} nodeMap - Node lookup by id.
 * @returns {number} Relative depth, or absolute depth when no root applies.
 */
function getRelativeDepth(node, activeRoot, nodeMap) {
  if (!activeRoot) return Number(node.depth || 0);
  if (!isNodeInSubtree(node, activeRoot.id, nodeMap)) return Number(node.depth || 0);
  return Math.max(0, Number(node.depth || 0) - Number(activeRoot.depth || 0));
}

/**
 * Returns graph nodes that match active filters.
 * @param {object} graph - Graph payload.
 * @param {{includeActiveRoot?: boolean}} [options] - Optional filter behavior overrides.
 * @returns {Array<object>} Filtered nodes.
 */
function getVisibleNodes(graph, options = {}) {
  const filters = readFilters();
  const nodeMap = buildNodeMap(graph.nodes);
  const activeRoot = getActiveRootNode(graph, nodeMap);
  return graph.nodes.filter((node) => {
    if (state.focusRootId && !isNodeInSubtree(node, state.focusRootId, nodeMap)) return false;
    for (const hiddenRootId of state.hiddenSubtreeRoots) {
      if (isNodeInSubtree(node, hiddenRootId, nodeMap)) return false;
    }
    if (!filters.showRoot) {
      const isActiveRoot = activeRoot?.id === node.id;
      if (isRootNode(node) && !(options.includeActiveRoot && isActiveRoot)) return false;
      if (isActiveRoot && !options.includeActiveRoot) return false;
    }
    if (getRelativeDepth(node, activeRoot, nodeMap) > filters.maxDepth) return false;
    if (!filters.showSystem && node.system) return false;
    if (filters.topLevel && node.topLevel !== filters.topLevel && !isRootNode(node)) return false;
    if (filters.search && !String(node.path || "").toLowerCase().includes(filters.search)) return false;
    return true;
  });
}

/**
 * Returns graph edges where both endpoints are visible.
 * @param {object} graph - Graph payload.
 * @param {Array<object>} visibleNodes - Filtered graph nodes.
 * @returns {Array<object>} Filtered graph edges.
 */
function getVisibleEdges(graph, visibleNodes) {
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  return graph.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
}

/**
 * Reads current graph node positions from ECharts before updating options.
 * @returns {Map<string, [number, number]>} Node id to current canvas coordinates.
 */
function readCurrentNodePositions() {
  const positions = new Map();
  const series = state.chart?.getModel()?.getSeriesByIndex(0);
  const data = series?.getData?.();
  if (!data?.each || !data?.getRawDataItem || !data?.getItemLayout) return positions;

  data.each((index) => {
    const raw = data.getRawDataItem(index);
    const id = String(raw?.id || raw?.path || raw?.name || "").trim();
    const layout = data.getItemLayout(index);
    if (!id || !Array.isArray(layout) || layout.length < 2) return;
    const x = Number(layout[0]);
    const y = Number(layout[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) positions.set(id, [x, y]);
  });

  return positions;
}

/**
 * Reads current pan/zoom state from the active series.
 * @returns {{zoom: number|null, center: Array<number>|null}} Current view transform when available.
 */
function readCurrentViewState() {
  const option = state.chart?.getOption?.();
  const series = option?.series?.[0] || {};
  return {
    zoom: Number.isFinite(Number(series.zoom)) ? Number(series.zoom) : null,
    center: Array.isArray(series.center) ? series.center : null
  };
}

/**
 * Applies a preserved pan/zoom state to an ECharts option object.
 * @param {object} option - ECharts option object to mutate.
 * @param {{zoom: number|null, center: Array<number>|null}} viewState - Preserved view transform.
 * @returns {object} Mutated option object.
 */
function applyViewState(option, viewState) {
  const series = option?.series?.[0];
  if (!series) return option;
  if (viewState.zoom != null) series.zoom = viewState.zoom;
  if (viewState.center) series.center = viewState.center;
  return option;
}

/**
 * Maps a depth value to a stable display color.
 * @param {number} depth - Node depth.
 * @param {number} maxDepth - Maximum graph depth.
 * @returns {string} Hex color.
 */
function colorForDepth(depth, maxDepth) {
  if (depth === 0) return "#773d29";
  const ratio = maxDepth <= 0 ? 0 : depth / maxDepth;
  if (ratio < 0.2) return "#c95f35";
  if (ratio < 0.4) return "#d99555";
  if (ratio < 0.6) return "#7d9f72";
  if (ratio < 0.8) return "#356b57";
  return "#284d5f";
}

/**
 * Returns a deterministic group color distributed around the hue wheel.
 * @param {number} index - Group index.
 * @param {number} relativeDepth - Node depth below the group root.
 * @returns {string} CSS HSL color string.
 */
function colorForGroup(index, relativeDepth) {
  const hue = (index * 137.508 + 205) % 360;
  const saturation = 70;
  const lightness = clamp(62 - relativeDepth * 5, 34, 72);
  return `hsl(${hue.toFixed(1)} ${saturation}% ${lightness}%)`;
}

/**
 * Builds lookup maps for visible graph nodes.
 * @param {Array<object>} visibleNodes - Filtered graph nodes.
 * @returns {{byId: Map<string, object>, byParent: Map<string, Array<object>>}} Node lookup maps.
 */
function buildVisibleNodeLookups(visibleNodes) {
  const byId = new Map();
  const byParent = new Map();

  for (const node of visibleNodes) {
    byId.set(node.id, node);
    const parentId = String(node.parentPath || "");
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(node);
  }

  for (const children of byParent.values()) {
    children.sort((a, b) => String(a.path || "").localeCompare(String(b.path || ""), "de"));
  }

  return { byId, byParent };
}

/**
 * Finds the local root for group coloring in the current rendered view.
 * @param {Array<object>} visibleNodes - Filtered graph nodes.
 * @param {Map<string, object>} byId - Visible node lookup by id.
 * @returns {object|null} Local root node or `null` for multi-root views.
 */
function findLocalColorRoot(visibleNodes, byId) {
  const filters = readFilters();
  if (filters.topLevel && byId.has(filters.topLevel)) return byId.get(filters.topLevel);

  const visibleRoot = visibleNodes.find(isRootNode);
  if (visibleRoot) return visibleRoot;

  const minDepth = visibleNodes.reduce((min, node) => Math.min(min, Number(node.depth || 0)), Infinity);
  const minDepthNodes = visibleNodes.filter((node) => Number(node.depth || 0) === minDepth);
  return minDepthNodes.length === 1 ? minDepthNodes[0] : null;
}

/**
 * Builds group color metadata for visible graph nodes.
 * @param {Array<object>} visibleNodes - Filtered graph nodes.
 * @returns {{localRootId: string, groupIndexById: Map<string, number>, groupRoots: Set<string>, nodeMap: Map<string, object>}} Group color context.
 */
function buildGroupColorContext(visibleNodes) {
  const { byId, byParent } = buildVisibleNodeLookups(visibleNodes);
  const localRoot = findLocalColorRoot(visibleNodes, byId);
  const groupIndexById = new Map();
  let groupRootNodes = [];
  let localRootId = "";

  if (localRoot) {
    localRootId = localRoot.id;
    groupRootNodes = byParent.get(localRoot.id) || [];
  } else {
    const minDepth = visibleNodes.reduce((min, node) => Math.min(min, Number(node.depth || 0)), Infinity);
    groupRootNodes = visibleNodes
      .filter((node) => Number(node.depth || 0) === minDepth)
      .sort((a, b) => String(a.path || "").localeCompare(String(b.path || ""), "de"));
  }

  groupRootNodes.forEach((node, index) => {
    groupIndexById.set(node.id, index);
  });

  return {
    localRootId,
    groupIndexById,
    groupRoots: new Set(groupRootNodes.map((node) => node.id)),
    nodeMap: byId
  };
}

/**
 * Resolves a node's group root and relative depth for group coloring.
 * @param {object} node - Node to classify.
 * @param {object} context - Group color context.
 * @returns {{groupId: string, relativeDepth: number}|null} Group assignment or `null`.
 */
function resolveNodeGroup(node, context) {
  if (!context.localRootId) {
    let current = node;
    let relativeDepth = 0;
    while (current) {
      if (context.groupRoots.has(current.id)) {
        return { groupId: current.id, relativeDepth };
      }
      current = context.nodeMap.get(current.parentPath);
      relativeDepth += 1;
    }
    return null;
  }

  if (node.id === context.localRootId) return null;

  let current = node;
  let relativeDepth = 0;
  while (current && current.parentPath !== context.localRootId) {
    current = context.nodeMap.get(current.parentPath);
    relativeDepth += 1;
  }

  return current ? { groupId: current.id, relativeDepth } : null;
}

/**
 * Resolves a node color for the active color mode.
 * @param {object} node - Node to color.
 * @param {number} maxDepth - Maximum graph depth.
 * @param {object} groupContext - Group color context.
 * @param {string} colorMode - Active color mode.
 * @returns {string} CSS color.
 */
function colorForNode(node, maxDepth, groupContext, colorMode) {
  if (colorMode !== "groups") return colorForDepth(Number(node.depth || 0), maxDepth);

  const assignment = resolveNodeGroup(node, groupContext);
  if (!assignment) return "#6f7885";

  const groupIndex = groupContext.groupIndexById.get(assignment.groupId);
  if (!Number.isInteger(groupIndex)) return "#6f7885";
  return colorForGroup(groupIndex, assignment.relativeDepth);
}

/**
 * Formats a byte value as a compact disk-size label.
 * @param {number} bytes - Byte count.
 * @returns {string} Human-readable file size.
 */
function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes || 0);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

/**
 * Converts graph nodes to ECharts data objects.
 * @param {Array<object>} nodes - Filtered graph nodes.
 * @param {number} maxDepth - Maximum graph depth.
 * @param {object} tuning - Active render controls.
 * @param {object} groupContext - Group color context.
 * @param {Map<string, [number, number]>} positions - Existing node positions.
 * @returns {Array<object>} ECharts node data.
 */
function toChartNodes(nodes, maxDepth, tuning, groupContext, positions) {
  return nodes.map((node) => {
    const descendants = Number(node.descendantFolderCount || 0);
    const size = Math.max(12, Math.min(62, 14 + Math.sqrt(descendants + 1) * 5));
    const scaledSize = clamp(size * tuning.nodeScale, 4, 140);
    const position = positions.get(node.id);
    return {
      ...node,
      name: node.id,
      displayName: node.name,
      value: descendants,
      symbolSize: isRootNode(node) ? clamp(68 * tuning.nodeScale, 8, 160) : scaledSize,
      ...(position ? { x: position[0], y: position[1] } : {}),
      itemStyle: {
        color: colorForNode(node, maxDepth, groupContext, tuning.colorMode),
        borderColor: node.system ? "rgba(32, 32, 29, 0.32)" : "rgba(255, 250, 240, 0.95)",
        borderWidth: node.system ? 1 : 2
      },
      label: {
        show: tuning.showLabels,
        formatter: node.name
      }
    };
  });
}

/**
 * Builds tree children for a node from visible folder nodes.
 * @param {object} node - Current source node.
 * @param {Map<string, Array<object>>} byParent - Visible children by parent id.
 * @param {number} maxDepth - Maximum graph depth.
 * @param {object} tuning - Active render controls.
 * @param {object} groupContext - Group color context.
 * @returns {object} ECharts tree node.
 */
function toTreeNode(node, byParent, maxDepth, tuning, groupContext) {
  const descendants = Number(node.descendantFolderCount || 0);
  const size = Math.max(8, Math.min(36, (10 + Math.sqrt(descendants + 1) * 2.4) * tuning.nodeScale));
  const children = (byParent.get(node.id) || []).map((child) =>
    toTreeNode(child, byParent, maxDepth, tuning, groupContext)
  );

  return {
    ...node,
    name: node.name,
    displayName: node.name,
    value: descendants,
    symbolSize: isRootNode(node) ? clamp(36 * tuning.nodeScale, 8, 80) : clamp(size, 3, 80),
    itemStyle: {
      color: colorForNode(node, maxDepth, groupContext, tuning.colorMode),
      borderColor: node.system ? "rgba(32, 32, 29, 0.32)" : "rgba(255, 250, 240, 0.95)",
      borderWidth: node.system ? 1 : 2
    },
    label: {
      show: tuning.showLabels,
      color: "#d9dde3",
      fontFamily: "Cascadia Mono, Fira Code, Consolas, monospace",
      fontSize: 11,
      textBorderColor: "#0d0f12",
      textBorderWidth: 3,
      position: "left",
      verticalAlign: "middle",
      align: "right"
    },
    children
  };
}

/**
 * Builds root nodes for tree rendering from the filtered visible node set.
 * @param {Array<object>} visibleNodes - Filtered graph nodes.
 * @returns {Array<object>} Root nodes for tree rendering.
 */
function findTreeRoots(visibleNodes) {
  const { byId } = buildVisibleNodeLookups(visibleNodes);
  const localRoot = findLocalColorRoot(visibleNodes, byId);
  if (localRoot) return [localRoot];

  return visibleNodes
    .filter((node) => !byId.has(node.parentPath))
    .sort((a, b) => String(a.path || "").localeCompare(String(b.path || ""), "de"));
}

/**
 * Builds a synthetic tree root when the visible set contains multiple roots.
 * @param {Array<object>} roots - Tree root nodes.
 * @param {Map<string, Array<object>>} byParent - Visible children by parent id.
 * @param {number} maxDepth - Maximum graph depth.
 * @param {object} tuning - Active render controls.
 * @param {object} groupContext - Group color context.
 * @returns {object} ECharts tree root data.
 */
function buildTreeData(roots, byParent, maxDepth, tuning, groupContext) {
  if (roots.length === 1) return toTreeNode(roots[0], byParent, maxDepth, tuning, groupContext);

  return {
    name: "Visible",
    displayName: "Visible",
    path: "",
    depth: 0,
    directFolderCount: roots.length,
    descendantFolderCount: roots.length,
    symbol: "none",
    label: {
      show: tuning.showLabels,
      color: "#8f98a3",
      fontFamily: "Cascadia Mono, Fira Code, Consolas, monospace",
      fontSize: 11
    },
    children: roots.map((node) => toTreeNode(node, byParent, maxDepth, tuning, groupContext))
  };
}

/**
 * Builds treemap data for one folder node.
 * @param {object} node - Source folder node.
 * @param {Map<string, Array<object>>} byParent - Visible children by parent id.
 * @param {number} maxDepth - Maximum graph depth.
 * @param {object} tuning - Active render controls.
 * @param {object} groupContext - Group color context.
 * @returns {object} ECharts treemap node.
 */
function toTreemapNode(node, byParent, maxDepth, tuning, groupContext) {
  const children = (byParent.get(node.id) || []).map((child) =>
    toTreemapNode(child, byParent, maxDepth, tuning, groupContext)
  );
  const bytes = Number(node.totalFileBytes || 0);
  return {
    ...node,
    name: node.name,
    displayName: node.name,
    value: Math.max(1, bytes),
    bytes,
    itemStyle: {
      color: colorForNode(node, maxDepth, groupContext, tuning.colorMode),
      borderColor: "#0d0f12",
      borderWidth: 1,
      gapWidth: 2
    },
    label: {
      show: tuning.showLabels,
      color: "#f4f7fb",
      fontFamily: "Cascadia Mono, Fira Code, Consolas, monospace",
      fontSize: 11,
      formatter: "{b}"
    },
    children
  };
}

/**
 * Builds treemap root data from visible folder nodes.
 * @param {Array<object>} roots - Visible root nodes.
 * @param {Map<string, Array<object>>} byParent - Visible children by parent id.
 * @param {number} maxDepth - Maximum graph depth.
 * @param {object} tuning - Active render controls.
 * @param {object} groupContext - Group color context.
 * @returns {object} ECharts treemap root data.
 */
function buildTreemapData(roots, byParent, maxDepth, tuning, groupContext) {
  if (roots.length === 1) return toTreemapNode(roots[0], byParent, maxDepth, tuning, groupContext);

  const bytes = roots.reduce((sum, node) => sum + Number(node.totalFileBytes || 0), 0);
  return {
    name: "Visible",
    displayName: "Visible",
    path: "",
    depth: 0,
    directFolderCount: roots.length,
    descendantFolderCount: roots.length,
    totalFileBytes: bytes,
    value: Math.max(1, bytes),
    children: roots.map((node) => toTreemapNode(node, byParent, maxDepth, tuning, groupContext))
  };
}

/**
 * Builds the ECharts option for the current graph view.
 * @param {object} graph - Graph payload.
 * @param {Array<object>} visibleNodes - Filtered graph nodes.
 * @param {Array<object>} visibleEdges - Filtered graph edges.
 * @param {Array<object>} colorContextNodes - Filtered graph nodes with active root retained for color grouping.
 * @param {Map<string, [number, number]>} positions - Existing node positions.
 * @returns {object} ECharts option object.
 */
function buildChartOption(graph, visibleNodes, visibleEdges, colorContextNodes, positions) {
  const maxDepth = Number(graph.stats?.maxDepth || 1);
  const tuning = readTuning();
  const groupContext = buildGroupColorContext(colorContextNodes);
  return {
    animation: false,
    animationDuration: 0,
    animationDurationUpdate: 0,
    tooltip: {
      trigger: "item",
      formatter(params) {
        if (params.dataType !== "node") return "";
        const data = params.data;
        return [
          `<strong>${data.displayName || data.name}</strong>`,
          `Depth: ${data.depth}`,
          `Direct folders: ${data.directFolderCount}`,
          `Descendants: ${data.descendantFolderCount}`
        ].join("<br>");
      }
    },
    series: [
      {
        type: "graph",
        id: "vault-folder-graph",
        layout: "force",
        layoutAnimation: false,
        roam: true,
        draggable: true,
        data: toChartNodes(visibleNodes, maxDepth, tuning, groupContext, positions),
        links: visibleEdges,
        edgeSymbol: ["none", "none"],
        lineStyle: {
          color: "rgba(125, 180, 255, 0.28)",
          width: tuning.lineWidth,
          curveness: 0.08
        },
        label: {
          color: "#d9dde3",
          fontFamily: "Cascadia Mono, Fira Code, Consolas, monospace",
          fontSize: 11,
          textBorderColor: "#0d0f12",
          textBorderWidth: 3,
          position: "right"
        },
        emphasis: {
          focus: "adjacency",
          label: {
            show: tuning.showLabels
          }
        },
        force: {
          repulsion: tuning.repulsion,
          edgeLength: [tuning.edgeMin, tuning.edgeMax],
          gravity: tuning.gravity,
          friction: tuning.friction
        }
      }
    ]
  };
}

/**
 * Builds the ECharts option for tree view.
 * @param {object} graph - Graph payload.
 * @param {Array<object>} visibleNodes - Filtered graph nodes.
 * @param {Array<object>} colorContextNodes - Filtered graph nodes with active root retained for color grouping.
 * @returns {object} ECharts option object.
 */
function buildTreeOption(graph, visibleNodes, colorContextNodes) {
  const maxDepth = Number(graph.stats?.maxDepth || 1);
  const tuning = readTuning();
  const groupContext = buildGroupColorContext(colorContextNodes);
  const { byParent } = buildVisibleNodeLookups(visibleNodes);
  const roots = findTreeRoots(visibleNodes);
  const treeData = buildTreeData(roots, byParent, maxDepth, tuning, groupContext);
  const verticalExpansion = (tuning.treeGapY - 18) * 6;
  const horizontalExpansion = tuning.treeGapX - 140;
  const right = tuning.treeLabelSpace - horizontalExpansion;

  return {
    animation: tuning.treeAnimation > 0,
    animationDuration: tuning.treeAnimation,
    animationDurationUpdate: tuning.treeAnimation,
    tooltip: {
      trigger: "item",
      formatter(params) {
        const data = params.data;
        return [
          `<strong>${data.displayName || data.name}</strong>`,
          `Depth: ${data.depth}`,
          `Direct folders: ${data.directFolderCount}`,
          `Descendants: ${data.descendantFolderCount}`
        ].join("<br>");
      }
    },
    series: [
      {
        type: "tree",
        id: "vault-folder-tree",
        data: [treeData],
        orient: "LR",
        top: 24 - verticalExpansion,
        left: 32,
        bottom: 24 - verticalExpansion,
        right,
        roam: true,
        expandAndCollapse: false,
        edgeShape: "polyline",
        lineStyle: {
          color: "rgba(125, 180, 255, 0.32)",
          width: tuning.lineWidth
        },
        leaves: {
          label: {
            position: "right",
            align: "left"
          }
        },
        emphasis: {
          focus: "descendant"
        }
      }
    ]
  };
}

/**
 * Builds the ECharts option for disk-usage treemap view.
 * @param {object} graph - Graph payload.
 * @param {Array<object>} visibleNodes - Filtered graph nodes.
 * @param {Array<object>} colorContextNodes - Filtered graph nodes with active root retained for color grouping.
 * @returns {object} ECharts option object.
 */
function buildTreemapOption(graph, visibleNodes, colorContextNodes) {
  const maxDepth = Number(graph.stats?.maxDepth || 1);
  const tuning = readTuning();
  const groupContext = buildGroupColorContext(colorContextNodes);
  const { byParent } = buildVisibleNodeLookups(visibleNodes);
  const roots = findTreeRoots(visibleNodes);
  const treemapData = buildTreemapData(roots, byParent, maxDepth, tuning, groupContext);
  const treemapSeriesData = roots.length === 1 ? [treemapData] : treemapData.children || [];

  return {
    animation: false,
    tooltip: {
      trigger: "item",
      formatter(params) {
        const data = params.data;
        return [
          `<strong>${data.displayName || data.name}</strong>`,
          `Size: ${formatBytes(data.bytes ?? data.totalFileBytes ?? data.value)}`,
          `Files: ${data.totalFileCount ?? 0}`,
          `Folders: ${data.descendantFolderCount ?? 0}`
        ].join("<br>");
      }
    },
    series: [
      {
        type: "treemap",
        id: "vault-folder-treemap",
        data: treemapSeriesData,
        roam: true,
        nodeClick: false,
        breadcrumb: {
          show: false
        },
        top: 8,
        left: 8,
        right: 8,
        bottom: 8,
        label: {
          show: tuning.showLabels,
          color: "#f4f7fb",
          fontFamily: "Cascadia Mono, Fira Code, Consolas, monospace",
          fontSize: 11,
          formatter: "{b}"
        },
        upperLabel: {
          show: tuning.showLabels,
          height: 22,
          color: "#f4f7fb",
          fontFamily: "Cascadia Mono, Fira Code, Consolas, monospace",
          fontSize: 11
        },
        levels: [
          {
            itemStyle: {
              borderColor: "#0d0f12",
              borderWidth: 2,
              gapWidth: 3
            }
          },
          {
            itemStyle: {
              borderColor: "#0d0f12",
              borderWidth: 1,
              gapWidth: 2
            }
          }
        ]
      }
    ]
  };
}

/**
 * Renders selected node details.
 * @param {object|null} node - Selected graph node.
 * @returns {void}
 */
function renderDetails(node) {
  if (!node) {
    elements.detailsList.innerHTML = `
      <dt>Folder</dt><dd>Select a graph node.</dd>
      <dt>Node Filters</dt><dd>${renderNodeFilterSummary()}</dd>
    `;
    return;
  }

  elements.detailsList.innerHTML = `
    <dt>Name</dt><dd>${escapeHtml(node.displayName || node.name)}</dd>
    <dt>Path</dt><dd>${escapeHtml(node.path)}</dd>
    <dt>Depth</dt><dd>${node.depth}</dd>
    <dt>Direct child folders</dt><dd>${node.directFolderCount}</dd>
    <dt>Descendant folders</dt><dd>${node.descendantFolderCount}</dd>
    <dt>Disk usage</dt><dd>${formatBytes(node.totalFileBytes || 0)}</dd>
    <dt>Files</dt><dd>${node.totalFileCount || 0}</dd>
    <dt>System folder</dt><dd>${node.system ? "yes" : "no"}</dd>
  `;
}

/**
 * Renders a compact node-filter summary.
 * @returns {string} HTML-safe filter summary.
 */
function renderNodeFilterSummary() {
  const parts = [];
  if (state.focusRootId) parts.push(`focus: ${state.focusRootId}`);
  if (state.hiddenSubtreeRoots.size) parts.push(`hidden: ${state.hiddenSubtreeRoots.size}`);
  return parts.length ? escapeHtml(parts.join(" | ")) : "none";
}

/**
 * Updates status text with graph and node-filter state.
 * @returns {void}
 */
function updateStatus() {
  if (!state.graph) return;
  const suffix = [];
  if (state.focusRootId) suffix.push("focused");
  if (state.hiddenSubtreeRoots.size) suffix.push(`${state.hiddenSubtreeRoots.size} hidden`);
  const base = `Ready: ${state.graph.stats?.folderCount || state.graph.nodes.length} folders`;
  setStatus(suffix.length ? `${base} | ${suffix.join(", ")}` : base);
}

/**
 * Handles selection-panel node action clicks.
 * @param {string} action - Action id.
 * @returns {void}
 */
function handleNodeAction(action) {
  const node = state.selectedNode;
  if (action === "reset") {
    state.focusRootId = "";
    state.hiddenSubtreeRoots.clear();
    renderDetails(node);
    renderGraph();
    updateStatus();
    hideNodeHud();
    return;
  }

  if (!node?.id) return;

  if (action === "focus") {
    state.focusRootId = node.id;
    elements.topLevelSelect.value = "";
  }

  if (action === "hide") {
    state.hiddenSubtreeRoots.add(node.id);
    if (state.focusRootId === node.id) state.focusRootId = "";
  }

  renderDetails(node);
  renderGraph();
  updateStatus();
  hideNodeHud();
}

/**
 * Shows the node action HUD near the graph click position.
 * @param {object} event - ECharts event object.
 * @returns {void}
 */
function showNodeHud(event) {
  const graphRect = elements.graph.getBoundingClientRect();
  const workspaceRect = elements.graph.parentElement.getBoundingClientRect();
  const rawOffsetX = Number(event?.event?.offsetX);
  const rawOffsetY = Number(event?.event?.offsetY);
  const fallbackX = graphRect.width / 2;
  const fallbackY = graphRect.height / 2;
  const x = graphRect.left - workspaceRect.left + (Number.isFinite(rawOffsetX) ? rawOffsetX : fallbackX);
  const y = graphRect.top - workspaceRect.top + (Number.isFinite(rawOffsetY) ? rawOffsetY : fallbackY);

  elements.nodeHud.hidden = false;
  const hudRect = elements.nodeHud.getBoundingClientRect();
  const maxX = Math.max(8, workspaceRect.width - hudRect.width - 8);
  const maxY = Math.max(8, workspaceRect.height - hudRect.height - 8);
  elements.nodeHud.style.left = `${clamp(x + 10, 8, maxX)}px`;
  elements.nodeHud.style.top = `${clamp(y + 10, 8, maxY)}px`;
}

/**
 * Hides the node action HUD.
 * @returns {void}
 */
function hideNodeHud() {
  elements.nodeHud.hidden = true;
}

/**
 * Escapes text before inserting it into HTML.
 * @param {unknown} value - Value to escape.
 * @returns {string} HTML-safe text.
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Populates top-level folder filter options.
 * @param {object} graph - Graph payload.
 * @returns {void}
 */
function populateTopLevelOptions(graph) {
  const currentValue = elements.topLevelSelect.value;
  const options = ['<option value="">All folders</option>'];
  for (const folder of graph.topLevelFolders || []) {
    options.push(`<option value="${escapeHtml(folder)}">${escapeHtml(folder)}</option>`);
  }
  elements.topLevelSelect.innerHTML = options.join("");
  elements.topLevelSelect.value = currentValue;
}

/**
 * Initializes or updates the ECharts graph instance.
 * @returns {void}
 */
function renderGraph() {
  if (!state.graph) return;
  if (!state.chart) {
    state.chart = echarts.init(elements.graph);
    state.chart.on("click", (params) => {
      if (!["graph", "tree", "treemap"].includes(params.seriesType)) return;
      if (!params.data || params.data.path == null) return;
      state.selectedNode = params.data;
      renderDetails(state.selectedNode);
      showNodeHud(params);
    });
  }

  const visibleNodes = getVisibleNodes(state.graph);
  const colorContextNodes = getVisibleNodes(state.graph, { includeActiveRoot: true });
  const visibleEdges = getVisibleEdges(state.graph, visibleNodes);
  const positions = readCurrentNodePositions();
  const viewState = readCurrentViewState();
  const option = applyViewState(
    state.viewMode === "tree"
      ? buildTreeOption(state.graph, visibleNodes, colorContextNodes)
      : state.viewMode === "treemap"
        ? buildTreemapOption(state.graph, visibleNodes, colorContextNodes)
      : buildChartOption(state.graph, visibleNodes, visibleEdges, colorContextNodes, positions),
    viewState
  );
  if (state.viewMode === "tree" || state.viewMode === "treemap") {
    state.chart.clear();
  }
  state.chart.setOption(option, {
    notMerge: state.viewMode === "tree" || state.viewMode === "treemap",
    lazyUpdate: false
  });

  if (state.selectedNode && !visibleNodes.some((node) => node.id === state.selectedNode.id)) {
    state.selectedNode = null;
    renderDetails(null);
    hideNodeHud();
  }
  updateStatus();
}

/**
 * Sets the active visualization mode.
 * @param {"graph"|"tree"|"treemap"} viewMode - View mode to activate.
 * @returns {void}
 */
function setViewMode(viewMode) {
  state.viewMode = viewMode;
  elements.graphViewButton.classList.toggle("is-active", viewMode === "graph");
  elements.treeViewButton.classList.toggle("is-active", viewMode === "tree");
  elements.treemapViewButton.classList.toggle("is-active", viewMode === "treemap");
  state.chart?.clear();
  renderGraph();
}

/**
 * Applies graph data to the UI.
 * @param {object} graph - Graph payload.
 * @returns {void}
 */
function setGraph(graph) {
  state.graph = graph;
  const maxDepth = Math.max(0, Number(graph.stats?.maxDepth || 0));
  elements.depthInput.max = String(maxDepth);
  elements.depthInput.value = String(maxDepth);
  elements.depthValue.textContent = String(maxDepth);
  populateTopLevelOptions(graph);
  renderGraph();
  updateStatus();
}

/**
 * Fetches graph data from the server when the generated global is unavailable.
 * @returns {Promise<object>} Graph payload.
 */
async function fetchGraph() {
  const response = await fetch("./api/graph");
  if (!response.ok) throw new Error(await response.text());
  const payload = await response.json();
  return payload.graph;
}

/**
 * Rebuilds graph data through the local server.
 * @returns {Promise<void>} Resolves when rebuild and render complete.
 */
async function rebuildGraph() {
  elements.rebuildButton.disabled = true;
  setStatus("Rebuilding graph...");
  try {
    const response = await fetch("./api/graph/rebuild", { method: "POST" });
    if (!response.ok) throw new Error(await response.text());
    const payload = await response.json();
    setGraph(payload.graph);
  } catch (error) {
    setStatus(`Rebuild failed: ${error.message || error}`);
  } finally {
    elements.rebuildButton.disabled = false;
  }
}

/**
 * Wires DOM event listeners.
 * @returns {void}
 */
function bindEvents() {
  elements.rebuildButton.addEventListener("click", () => {
    rebuildGraph();
  });

  elements.graphViewButton.addEventListener("click", () => setViewMode("graph"));
  elements.treeViewButton.addEventListener("click", () => setViewMode("tree"));
  elements.treemapViewButton.addEventListener("click", () => setViewMode("treemap"));
  elements.nodeHud.addEventListener("click", (event) => {
    const button = event.target.closest("[data-node-action]");
    if (!button) return;
    handleNodeAction(String(button.dataset.nodeAction || ""));
  });
  elements.graph.addEventListener("pointerdown", () => {
    if (!elements.nodeHud.hidden) hideNodeHud();
  });

  for (const input of [
    elements.searchInput,
    elements.rootToggle,
    elements.systemToggle,
    elements.labelsToggle
  ]) {
    input.addEventListener("input", renderGraph);
    input.addEventListener("change", renderGraph);
  }

  elements.topLevelSelect.addEventListener("input", () => {
    state.focusRootId = "";
    renderGraph();
  });
  elements.topLevelSelect.addEventListener("change", () => {
    state.focusRootId = "";
    renderGraph();
  });

  for (const [inputKey] of tuningControls) {
    elements[inputKey].addEventListener("input", () => {
      updateTuningLabels();
      renderGraph();
    });
  }

  elements.colorModeSelect.addEventListener("input", renderGraph);
  elements.colorModeSelect.addEventListener("change", renderGraph);

  elements.depthInput.addEventListener("input", () => {
    elements.depthValue.textContent = elements.depthInput.value;
    renderGraph();
  });

  window.addEventListener("resize", () => {
    state.chart?.resize();
  });
}

/**
 * Starts the VaultGraph frontend.
 * @returns {Promise<void>} Resolves after initial render.
 */
async function init() {
  bindEvents();
  updateTuningLabels();
  try {
    if (state.graph) {
      setGraph(state.graph);
      return;
    }
    setGraph(await fetchGraph());
  } catch (error) {
    setStatus(`Load failed: ${error.message || error}`);
  }
}

init();
