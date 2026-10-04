'use strict';
// User decision: all AI features remain reserved. No renderer may opt in.
const AI_ENABLED = false;
function rejectAiRequest(){const error=new Error('AI 暂未启用：本轮只保留入口，不执行 Insights、语义分析或 OCR。');error.code='AI_DISABLED';throw error;}
module.exports={AI_ENABLED,rejectAiRequest};
