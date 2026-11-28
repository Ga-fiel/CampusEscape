import { createInterface } from 'node:readline';
import { createHeadlessGame } from './src/headless.js';

// Reserve stdout exclusively for JSON-RPC messages.
console.log = console.info = console.debug = (...args) => console.error(...args);

const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const booleanInputs = ['forward', 'back', 'left', 'right', 'run', 'crouch', 'jump', 'pressedE', 'eHeld'];
const numberInputs = ['mouseDX', 'mouseDY'];
const inputProperties = Object.fromEntries([
  ...booleanInputs.map(key => [key, { type: 'boolean' }]),
  ...numberInputs.map(key => [key, { type: 'number', minimum: -10000, maximum: 10000 }]),
]);
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const tools = [
  { name: 'reset', description: 'Create a fresh game and start it. Optional search contains URL query parameters for game debug settings.', inputSchema: schema({ search: { type: 'string', maxLength: 2048 } }) },
  { name: 'state', description: 'Get the current game state, including dialogue and available options.', inputSchema: schema() },
  { name: 'step', description: 'Advance game time. Unspecified input fields retain their previous values; set held keys to false to release them. Mouse movement and pressedE are consumed by the game.', inputSchema: schema({ seconds: { type: 'number', minimum: 0, maximum: 60 }, input: schema(inputProperties) }, ['seconds']) },
  { name: 'choose', description: 'Choose an enabled dialogue option using its zero-based index from state.dialogue.options.', inputSchema: schema({ index: { type: 'integer', minimum: 0 } }, ['index']) },
  { name: 'respawn', description: 'Respawn at the current save point.', inputSchema: schema() },
];
let game;
let initialized = false;

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validate(args, allowed, required = []) {
  if (!object(args)) throw new Error('arguments must be an object');
  for (const key of Object.keys(args)) if (!allowed.includes(key)) throw new Error(`Unknown argument: ${key}`);
  for (const key of required) if (!Object.hasOwn(args, key)) throw new Error(`Missing argument: ${key}`);
}
function currentGame() {
  if (!game) throw new Error('Call reset to initialize the game first');
  return game;
}
function callTool(name, args) {
  switch (name) {
    case 'reset': {
      validate(args, ['search']);
      if (args.search !== undefined && (typeof args.search !== 'string' || args.search.length > 2048)) throw new Error('search must be a string of at most 2048 characters');
      const next = createHeadlessGame({ search: args.search ?? '' });
      next.start();
      game = next;
      return game.getState();
    }
    case 'state':
      validate(args, []);
      return currentGame().getState();
    case 'step': {
      validate(args, ['seconds', 'input'], ['seconds']);
      if (typeof args.seconds !== 'number' || !Number.isFinite(args.seconds) || args.seconds < 0 || args.seconds > 60) throw new Error('seconds must be a finite number between 0 and 60');
      const input = args.input === undefined ? {} : args.input;
      validate(input, [...booleanInputs, ...numberInputs]);
      for (const [key, value] of Object.entries(input)) {
        if (booleanInputs.includes(key) && typeof value !== 'boolean') throw new Error(`${key} must be a boolean`);
        if (numberInputs.includes(key) && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 10000)) throw new Error(`${key} must be a finite number between -10000 and 10000`);
      }
      return currentGame().step(args.seconds, input);
    }
    case 'choose': {
      validate(args, ['index'], ['index']);
      if (!Number.isSafeInteger(args.index) || args.index < 0) throw new Error('index must be a non-negative integer');
      const active = currentGame();
      const dialogue = active.getState().dialogue;
      if (!dialogue) throw new Error('No dialogue is active');
      const option = dialogue.options[args.index];
      if (!option || !option.enabled) throw new Error('Dialogue option does not exist or is disabled');
      active.choose(args.index);
      return active.getState();
    }
    case 'respawn':
      validate(args, []);
      currentGame().respawn();
      return game.getState();
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
function error(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }
function handle(message) {
  if (!object(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || (Object.hasOwn(message, 'id') && typeof message.id !== 'string' && !(typeof message.id === 'number' && Number.isSafeInteger(message.id)))) {
    error(null, -32600, 'Invalid Request');
    return;
  }
  const hasId = Object.hasOwn(message, 'id');
  if (!hasId) return;
  const { id, method } = message;
  const params = message.params === undefined ? {} : message.params;
  if (!object(params)) return error(id, -32602, 'Invalid params');
  if (method === 'initialize') {
    if (initialized || typeof params.protocolVersion !== 'string' || !object(params.capabilities) || !object(params.clientInfo) || typeof params.clientInfo.name !== 'string' || typeof params.clientInfo.version !== 'string') return error(id, -32602, 'Invalid initialize parameters');
    initialized = true;
    return send({ jsonrpc: '2.0', id, result: { protocolVersion: versions.includes(params.protocolVersion) ? params.protocolVersion : versions[0], capabilities: { tools: {} }, serverInfo: { name: 'taoxue-headless', version: '1.0.0' } } });
  }
  if (!initialized) return error(id, -32002, 'Server not initialized');
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools } });
  if (method === 'tools/call') {
    if (typeof params.name !== 'string' || (params.arguments !== undefined && !object(params.arguments))) return error(id, -32602, 'Invalid tool call parameters');
    if (!tools.some(tool => tool.name === params.name)) return error(id, -32602, 'Unknown tool');
    try {
      const result = callTool(params.name, params.arguments ?? {});
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
    } catch (err) {
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: err.message }], isError: true } });
    }
  }
  return error(id, -32601, 'Method not found');
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { error(null, -32700, 'Parse error'); return; }
  try { handle(message); } catch (err) { console.error(err); if (object(message) && Object.hasOwn(message, 'id')) error(message.id, -32603, 'Internal error'); }
});
