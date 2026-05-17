import { Driver } from "/opt/zwave-js-dev/bin/handover/node_modules/zwave-js/build/cjs/index.js";
// Read-only — just check is_virtual_node from Pi's running view
import WebSocket from "ws";
const ws = new WebSocket("ws://192.168.50.184:3000");
ws.on("open", () => {
  setTimeout(() => ws.send(JSON.stringify({ messageId:"1", command:"set_api_schema", schemaVersion: 41 })), 300);
  setTimeout(() => ws.send(JSON.stringify({ messageId:"2", command:"start_listening" })), 600);
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.result?.state) {
    const n111 = m.result.state.nodes.find(n => n.nodeId === 111);
    const n110 = m.result.state.nodes.find(n => n.nodeId === 110);
    console.log("node 111 fields:");
    for (const [k, v] of Object.entries(n111 ?? {})) {
      if (typeof v !== "object") console.log(`  ${k} = ${v}`);
    }
    console.log("\nnode 110 (Pi controller) for comparison:");
    for (const [k, v] of Object.entries(n110 ?? {})) {
      if (typeof v !== "object" && (k.includes("Node") || k.includes("Controller") || k.includes("virtual"))) console.log(`  ${k} = ${v}`);
    }
    process.exit(0);
  }
});
