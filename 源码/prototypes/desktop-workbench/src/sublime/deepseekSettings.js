// Local form presets only. Applying this object never calls a model or stores a key.
export const DEEPSEEK_PRESET = Object.freeze({
  provider: 'api', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-flash',
});

export function isDeepSeekEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && url.hostname.toLowerCase().replace(/\.$/, '') === 'api.deepseek.com';
  } catch { return false; }
}
