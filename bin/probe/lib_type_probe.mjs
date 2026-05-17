import WebSocket from "ws";
const ws = new WebSocket(process.argv[2]);
let id = 1;
const send = (cmd) => new Promise((res) => {
  const mid = String(id++);
  ws.send(JSON.stringify({ messageId: mid, ...cmd }));
  const h = (raw) => {
    const m = JSON.parse(raw);
    if (m.messageId === mid) { ws.off("message", h); res(m); }
  };
  ws.on("message", h);
});
ws.on("open", async () => {
  await new Promise((r) => setTimeout(r, 500));
  await send({ command: "set_api_schema", schemaVersion: 41 });
  await send({ command: "start_listening" });
  await new Promise((r) => setTimeout(r, 1500));
  process.exit(0);
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.event?.event === "state") {
    const c = m.event.state.controller;
    console.log(`type=${c.type} (lib enum)  libraryVersion=${c.libraryVersion}  controllerType=${c.controllerType}  isStaticUpdateController=${c.isStaticUpdateController}  isSecondary=${c.isSecondary}  isPrimary=${c.isPrimary}  isSISPresent=${c.isSISPresent}  isSUC=${c.isSUC}  sucNodeId=${c.sucNodeId}  ownNodeId=${c.ownNodeId}`);
  } else if (m.result?.state) {
    const c = m.result.state.controller;
    console.log(`type=${c.type} (lib enum)  libraryVersion=${c.libraryVersion}  controllerType=${c.controllerType}  isStaticUpdateController=${c.isStaticUpdateController}  isSecondary=${c.isSecondary}  isPrimary=${c.isPrimary}  isSISPresent=${c.isSISPresent}  isSUC=${c.isSUC}  sucNodeId=${c.sucNodeId}  ownNodeId=${c.ownNodeId}`);
  }
});
