import WebSocket from "ws";
const ws = new WebSocket("ws://192.168.50.184:3000");
ws.on("open", () => {
  setTimeout(() => {
    ws.send(JSON.stringify({ messageId:"1", command:"set_api_schema", schemaVersion: 41 }));
  }, 300);
  setTimeout(() => {
    ws.send(JSON.stringify({ messageId:"2", command:"start_listening" }));
  }, 600);
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.result?.state) {
    const nodes = m.result.state.nodes.map(n => n.nodeId).sort((a,b)=>a-b);
    const high = nodes.filter(n => n >= 230);
    console.log(`total nodes: ${nodes.length}`);
    console.log(`high IDs (>=230): [${high.join(",")}]`);
    console.log(`all IDs: ${nodes.join(",")}`);
    process.exit(0);
  }
});
