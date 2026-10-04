"use strict";

const DEFAULT_MAX_NODES = 120;
const DEFAULT_MAX_VAULT_NODES = 320;

function isMarkdownPath(value) {
  return typeof value === "string" && value.toLowerCase().endsWith(".md");
}

function linkCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 1;
}

function fallbackTitle(path) {
  const basename = String(path || "").split("/").pop() || "未命名笔记";
  return basename.replace(/\.md$/i, "");
}

function safeTitle(path, getTitle) {
  try {
    const title = getTitle?.(path);
    if (typeof title === "string" && title.trim()) return title.trim();
  } catch (_) {}
  return fallbackTitle(path);
}

function unorderedPair(left, right) {
  return left.localeCompare(right) <= 0 ? [left, right] : [right, left];
}

function stablePathScore(path) {
  let hash = 2166136261;
  for (const char of String(path || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildAdjacency(resolvedLinks) {
  const adjacency = new Map();
  const directed = [];
  const connect = (left, right, count) => {
    if (!adjacency.has(left)) adjacency.set(left, new Map());
    adjacency.get(left).set(right, (adjacency.get(left).get(right) || 0) + count);
  };

  for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
    if (!isMarkdownPath(sourcePath) || !targets || typeof targets !== "object") continue;
    for (const [targetPath, rawCount] of Object.entries(targets)) {
      if (!isMarkdownPath(targetPath) || sourcePath === targetPath) continue;
      const count = linkCount(rawCount);
      directed.push({ source: sourcePath, target: targetPath, count });
      connect(sourcePath, targetPath, count);
      connect(targetPath, sourcePath, count);
    }
  }
  return { adjacency, directed };
}

function directDirection(centerPath, path, directed) {
  let incoming = 0;
  let outgoing = 0;
  for (const edge of directed) {
    if (edge.source === centerPath && edge.target === path) outgoing += edge.count;
    if (edge.source === path && edge.target === centerPath) incoming += edge.count;
  }
  return {
    incoming,
    outgoing,
    direction: incoming > 0 && outgoing > 0
      ? "mutual"
      : outgoing > 0
        ? "outgoing"
        : "incoming"
  };
}

function buildBookLocalGraph(options = {}) {
  const centerPath = typeof options.centerPath === "string" ? options.centerPath : "";
  const resolvedLinks = options.resolvedLinks && typeof options.resolvedLinks === "object"
    ? options.resolvedLinks
    : {};
  const depth = Math.min(3, Math.max(1, Math.floor(Number(options.depth) || 1)));
  const maximum = Number.isFinite(options.maxNodes)
    ? Math.max(2, Math.floor(options.maxNodes))
    : Number.isFinite(options.maxNeighbors)
      ? Math.max(2, Math.floor(options.maxNeighbors) + 1)
      : DEFAULT_MAX_NODES;
  const includeVaultContext = options.includeVaultContext === true;
  const maximumVaultNodes = Number.isFinite(options.maxVaultNodes)
    ? Math.max(maximum, Math.floor(options.maxVaultNodes))
    : DEFAULT_MAX_VAULT_NODES;

  if (!isMarkdownPath(centerPath)) {
    return {
      nodes: [], edges: [], depth, directNeighborCount: 0,
      totalReachable: 0, hiddenNodes: 0,
      totalVaultNodes: 0, hiddenVaultNodes: 0, vaultContextNodeCount: 0
    };
  }

  const { adjacency, directed } = buildAdjacency(resolvedLinks);
  const distanceByPath = new Map([[centerPath, 0]]);
  const queue = [centerPath];
  const discovered = [];

  while (queue.length) {
    const path = queue.shift();
    const distance = distanceByPath.get(path);
    if (distance >= depth) continue;
    const neighbors = [...(adjacency.get(path)?.entries() || [])]
      .sort((left, right) => (
        right[1] - left[1]
        || (adjacency.get(right[0])?.size || 0) - (adjacency.get(left[0])?.size || 0)
        || safeTitle(left[0], options.getTitle).localeCompare(safeTitle(right[0], options.getTitle), "zh-CN")
      ));
    for (const [neighborPath] of neighbors) {
      if (distanceByPath.has(neighborPath)) continue;
      const neighborDistance = distance + 1;
      distanceByPath.set(neighborPath, neighborDistance);
      discovered.push(neighborPath);
      queue.push(neighborPath);
    }
  }

  const localPaths = new Set([centerPath, ...discovered.slice(0, maximum - 1)]);
  const selectedPaths = new Set(localPaths);
  const vaultPaths = new Set([centerPath]);
  for (const path of options.allPaths || []) {
    if (isMarkdownPath(path)) vaultPaths.add(path);
  }
  for (const edge of directed) {
    vaultPaths.add(edge.source);
    vaultPaths.add(edge.target);
  }
  if (includeVaultContext) {
    const remaining = [...vaultPaths]
      .filter((path) => !selectedPaths.has(path))
      .sort((left, right) => (
        (adjacency.get(right)?.size || 0) - (adjacency.get(left)?.size || 0)
        || stablePathScore(left) - stablePathScore(right)
      ));
    for (const path of remaining) {
      if (selectedPaths.size >= maximumVaultNodes) break;
      selectedPaths.add(path);
    }
  }
  const directionByPath = new Map();
  for (const path of selectedPaths) {
    if (path === centerPath) continue;
    directionByPath.set(
      path,
      distanceByPath.get(path) === 1
        ? directDirection(centerPath, path, directed)
        : { incoming: 0, outgoing: 0, direction: "context" }
    );
  }

  const edgeMap = new Map();
  for (const edge of directed) {
    if (!selectedPaths.has(edge.source) || !selectedPaths.has(edge.target)) continue;
    const [left, right] = unorderedPair(edge.source, edge.target);
    const key = `${left}\u0000${right}`;
    const aggregate = edgeMap.get(key) || {
      source: left,
      target: right,
      forward: 0,
      backward: 0
    };
    if (edge.source === left) aggregate.forward += edge.count;
    else aggregate.backward += edge.count;
    edgeMap.set(key, aggregate);
  }

  const nodes = [...selectedPaths]
    .map((path) => {
      const distance = localPaths.has(path) ? (distanceByPath.get(path) || 0) : null;
      const directionInfo = path === centerPath
        ? { incoming: 0, outgoing: 0, direction: "center" }
        : localPaths.has(path)
          ? directionByPath.get(path)
          : { incoming: 0, outgoing: 0, direction: "vault" };
      return {
        path,
        title: safeTitle(path, options.getTitle),
        isCenter: path === centerPath,
        isLocal: localPaths.has(path),
        distance,
        degree: adjacency.get(path)?.size || 0,
        ...directionInfo
      };
    })
    .sort((left, right) => (
      Number(right.isLocal) - Number(left.isLocal)
      || (left.distance ?? 99) - (right.distance ?? 99)
      || right.degree - left.degree
      || left.title.localeCompare(right.title, "zh-CN")
    ));

  const edges = [...edgeMap.values()].map((edge) => ({
    ...edge,
    strength: edge.forward + edge.backward,
    mutual: edge.forward > 0 && edge.backward > 0,
    isLocal: localPaths.has(edge.source) && localPaths.has(edge.target)
  }));
  const directNeighborCount = [...distanceByPath.values()].filter((distance) => distance === 1).length;

  return {
    nodes,
    edges,
    depth,
    directNeighborCount,
    totalReachable: discovered.length,
    hiddenNodes: Math.max(0, discovered.length - (maximum - 1)),
    totalVaultNodes: vaultPaths.size,
    hiddenVaultNodes: Math.max(0, vaultPaths.size - selectedPaths.size),
    vaultContextNodeCount: Math.max(0, selectedPaths.size - localPaths.size)
  };
}

module.exports = {
  DEFAULT_MAX_NODES,
  DEFAULT_MAX_VAULT_NODES,
  buildBookLocalGraph,
  fallbackTitle,
  isMarkdownPath
};
