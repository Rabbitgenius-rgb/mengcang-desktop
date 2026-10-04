"use strict";

const NATIVE_LOCAL_GRAPH_VIEW_TYPE = "localgraph";

function makeNativeBookGraphViewState(path) {
  const filePath = typeof path === "string" ? path.trim() : "";
  if (!filePath.toLowerCase().endsWith(".md")) return null;
  return {
    type: NATIVE_LOCAL_GRAPH_VIEW_TYPE,
    active: true,
    state: { file: filePath }
  };
}

module.exports = {
  NATIVE_LOCAL_GRAPH_VIEW_TYPE,
  makeNativeBookGraphViewState
};
