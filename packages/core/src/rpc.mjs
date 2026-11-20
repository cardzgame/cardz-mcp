import { INSTRUCTIONS, PROTOCOL_VERSIONS, SERVER_INFO } from './constants.mjs';
import { CardzApiError } from './client.mjs';
import { callTool, tools } from './tools.mjs';

export const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

export async function dispatchRpc(body, options = {}) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    body.jsonrpc !== '2.0' ||
    typeof body.method !== 'string' ||
    ('id' in body &&
      body.id !== null &&
      typeof body.id !== 'string' &&
      !(typeof body.id === 'number' && Number.isFinite(body.id)))
  ) {
    return rpcError(null, -32600, 'Invalid JSON-RPC request.');
  }

  // Notifications have no id
  if (!('id' in body)) return null;

  const { id, method, params } = body;
  const serverInfo = options.serverInfo ?? SERVER_INFO;
  const capabilities = options.capabilities ?? { tools: {} };
  const toolList = options.tools ?? tools;

  let result;
  if (method === 'server/discover') {
    result = {
      supportedVersions: PROTOCOL_VERSIONS,
      capabilities,
      serverInfo,
      instructions: INSTRUCTIONS,
    };
  } else if (method === 'initialize') {
    result = {
      protocolVersion: PROTOCOL_VERSIONS.includes(params?.protocolVersion)
        ? params.protocolVersion
        : PROTOCOL_VERSIONS[0],
      capabilities,
      serverInfo,
      instructions: INSTRUCTIONS,
    };
  } else if (method === 'ping') {
    result = {};
  } else if (method === 'tools/list') {
    result = { tools: toolList };
  } else if (method === 'tools/call') {
    if (!params || typeof params.name !== 'string' || !tools.some((entry) => entry.name === params.name)) {
      return rpcError(id, -32602, 'Unknown tool.');
    }
    try {
      const data = await callTool(params.name, params.arguments ?? {}, options);
      result = {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        structuredContent: data,
      };
      if (options.toolResultMeta) {
        result._meta = { ...options.toolResultMeta };
      }
    } catch (error) {
      const payload =
        error instanceof CardzApiError
          ? {
              errorCode: error.errorCode,
              message: error.message,
              ...(error.retryAfterSeconds !== null ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
            }
          : { errorCode: 'TOOL_ERROR', message: error instanceof Error ? error.message : 'Tool execution failed.' };
      result = {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(payload) }],
      };
    }
  } else {
    return rpcError(id, -32601, 'Method not found.');
  }
  return { jsonrpc: '2.0', id, result };
}
