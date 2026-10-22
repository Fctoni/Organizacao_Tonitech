import { mcpHandler } from '../server/mcp.mjs';
export const config = { api: { bodyParser: false } };
export default mcpHandler();
