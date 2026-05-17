import WebSocket from "ws";
async function probe(url, label) {
  return new Promise((res) => {
    const ws = new WebSocket(url);
    ws.on("open", () => {
      setTimeout(() => ws.send(JSON.stringify({ messageId:"1", command:"set_api_schema", schemaVersion: 41 })), 300);
      setTimeout(() => ws.send(JSON.stringify({ messageId:"2", command:"start_listening" })), 600);
    });
    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.result?.state) {
        const node111 = m.result.state.nodes.find(n => n.nodeId === 111);
        console.log(`\n[${label}] sees node 111:`, node111 ? "YES" : "NO");
        if (node111) {
          console.log("  status:", node111.status);
          console.log("  isController:", node111.isControllerNode);
          console.log("  deviceClass:", JSON.stringify(node111.deviceClass));
          console.log("  isSecure:", node111.isSecure);
          console.log("  ready:", node111.ready);
          console.log("  interviewStage:", node111.interviewStage);
        }
        ws.close();
        res();
      }
    });
    setTimeout(() => { ws.close(); res(); }, 5000);
  });
}
await probe("ws://192.168.50.184:3000", "Pi");
await probe("ws://192.168.70.10:3000", "HA");
