// One-off: from HA's primary, send RequestNetworkUpdate to the Pi (SIS).
// Pulls down any nodes the SIS knows about that HA doesn't.
// Use when the SIS has allocated a node (e.g. a virtual slave) and HA's
// controller hasn't learned about it yet.
//
// STATUS — NON-FUNCTIONAL AS OF 2026-05-17 (gap in vanilla zwave-js):
// zwave-js v15.23.5 does not implement requestNetworkUpdate on Controller
// (only the FunctionType.RequestNetworkUpdate = 0x53 constant is defined).
// To make this work, either:
//   (a) Add RequestNetworkUpdateRequest / RequestNetworkUpdateCallback
//       message classes to our fork's serial package, then call
//       driver.sendMessage(new RequestNetworkUpdateRequest()) here, OR
//   (b) Take the spec-correct path instead: implement
//       VirtualNodeSendNodeInfoRequest (0xA2) on the Pi side and broadcast
//       NIF from the new virtual node to HA (NodeID 1). Per OpenZWave's
//       canonical bridge-controller flow, this is what should happen
//       immediately after AssignNodeIdDone — the radio's ADD does NOT
//       automatically replicate to other primary controllers on the mesh.
//
// Path (b) is the right architectural answer; path (a) is the diagnostic
// equivalent of pulling instead of pushing. Both unblock Phase 4 closure.

import { Driver } from "zwave-js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = "/dev/serial/by-id/usb-Zooz_800_Z-Wave_Stick_533D004242-if00";

const driver = new Driver(PORT, {
	storage: {
		cacheDir: path.join(__dirname, "cache"),
		lockDir: path.join(__dirname, "cache", ".lock"),
	},
	logConfig: { enabled: true, level: "info" },
});

driver.on("error", (e) => {
	console.error("\n!!! Driver error:", e);
	process.exit(1);
});

driver.once("driver ready", async () => {
	console.log("\n[driver ready]");
	const c = driver.controller;
	console.log(
		`  ownNodeId=${c.ownNodeId} sucNodeId=${c.sucNodeId} isSUC=${c.isSUC} isSISPresent=${c.isSISPresent}`,
	);
	const nodesBefore = Array.from(c.nodes.keys()).sort((a, b) => a - b);
	console.log(`  nodes before: ${nodesBefore.length} known`);
	console.log(`  node 111 known? ${nodesBefore.includes(111)}`);

	console.log(`\n[execute] calling controller.requestNetworkUpdate()...`);
	try {
		const result = await c.requestNetworkUpdate();
		console.log(`[execute] requestNetworkUpdate returned: ${result}`);
	} catch (e) {
		console.error(`\n!!! requestNetworkUpdate FAILED:`, e);
		await driver.destroy();
		process.exit(2);
	}

	// Let state propagate
	await new Promise((r) => setTimeout(r, 4000));

	const nodesAfter = Array.from(c.nodes.keys()).sort((a, b) => a - b);
	console.log(`\n=== after RequestNetworkUpdate ===`);
	console.log(`  nodes after:  ${nodesAfter.length} known`);
	console.log(`  node 111 known? ${nodesAfter.includes(111)}`);
	const added = nodesAfter.filter((n) => !nodesBefore.includes(n));
	const removed = nodesBefore.filter((n) => !nodesAfter.includes(n));
	if (added.length) console.log(`  newly learned: [${added.join(",")}]`);
	if (removed.length) console.log(`  forgotten:     [${removed.join(",")}]`);

	await driver.destroy();
	process.exit(0);
});

console.log(`[start] opening ${PORT}…`);
await driver.start();
