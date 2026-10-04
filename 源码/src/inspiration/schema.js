const PALETTE = ['#D5EBE1', '#98B6C2', '#A8BF8F', '#DDBB99'];

function colorForId(id) {
  const hash = Array.from(String(id)).reduce((value, char) => Math.imul(value ^ char.codePointAt(0), 16777619), 2166136261);
  return PALETTE[(hash >>> 5) % PALETTE.length];
}

module.exports = { PALETTE, colorForId };
