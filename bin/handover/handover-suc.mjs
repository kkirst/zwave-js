// One-off SIS handover script — moves SUC/SIS from HA's primary stick (node 1)
// to the Pi (node 110), unlocking SLAVE_LEARN_MODE_ADD per SiLabs INS13954 §4.6.2.
//
// CRITICAL: HA's zwave-js-ui container MUST be stopped first — the USB stick
// can only be owned by one process at a time. The wrapper script handles
// stop/start; this file only contains the driver-level handover logic.
//
// Modes:
//   --dry-run   (default) — connect, print state, exit without changes
//   --execute             — actually call configureSUC(110, true, true)
//
// Uses vanilla zwave-js (NOT our fork) to keep added bridge code off the
// handover critical path. Throwaway cache at ./cache so this never touches
// HA's real /opt/home-assistant/zwave-store.

import { Driver } from "zwave-js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = "/dev/serial/by-id/usb-Zooz_800_Z-Wave_Stick_533D004242-if00";
const TARGET_NODE = 110;
const EXECUTE = process.argv.includes("--execute");

const driver = new Driver(PORT, {
	storage: {
		cacheDir: path.join(__dirname, "cache"),
		// Lock dir explicitly so it doesn't collide with HA's
		lockDir: path.join(__dirname, "cache", ".lock"),
	},
	logConfig: { enabled: true, level: "info" },
});

driver.on("error", (e) => {
	console.error("\n!!! Driver error:", e);
	process.exit(1);
});

function printState(label) {
	const c = driver.controller;
	console.log(`\n=== ${label} ===`);
	console.log(`  ownNodeId       = ${c.ownNodeId}`);
	console.log(`  sucNodeId       = ${c.sucNodeId}`);
	console.log(`  isSUC           = ${c.isSUC}`);
	console.log(`  isSISPresent    = ${c.isSISPresent}`);
	console.log(`  isPrimary       = ${c.isPrimary}`);
	console.log(`  isSecondary     = ${c.isSecondary}`);
	console.log(`  nodes known     = ${c.nodes.size}`);
	const target = c.nodes.get(TARGET_NODE);
	if (target) {
		console.log(`  node ${TARGET_NODE} status = ${target.status} (4 = Alive)`);
	} else {
		console.log(`  node ${TARGET_NODE}        = NOT FOUND in controller's node list`);
	}
}

driver.once("driver ready", async () => {
	console.log("\n[driver ready]");
	printState("Current state (before handover)");

	if (!EXECUTE) {
		console.log("\nDRY-RUN — not executing configureSUC. Re-run with --execute to perform the handover.");
		await driver.destroy();
		process.exit(0);
	}

	const target = driver.controller.nodes.get(TARGET_NODE);
	if (!target) {
		console.error(
			`\n!!! ABORT — target node ${TARGET_NODE} is not in the controller's node list.`,
		);
		await driver.destroy();
		process.exit(1);
	}
	// We don't strictly check NodeStatus — the throwaway cache means
	// status is usually Unknown (0) on the first run. configureSUC has
	// its own timeout if the target node is unreachable, so a wireless
	// failure is a clean rollback (no state change), not a corruption risk.
	if (target.status !== 4 /* Alive */) {
		console.log(
			`  note: node ${TARGET_NODE} status=${target.status} (0=Unknown is expected with throwaway cache; configureSUC will time out cleanly if Pi is truly offline)`,
		);
	}

	console.log(
		`\n[execute] calling controller.configureSUC(${TARGET_NODE}, enableSUC=true, enableSIS=true)…`,
	);
	try {
		const result = await driver.controller.configureSUC(
			TARGET_NODE,
			true,
			true,
		);
		console.log(`[execute] configureSUC returned: ${result}`);
	} catch (e) {
		console.error(`\n!!! configureSUC FAILED:`, e);
		await driver.destroy();
		process.exit(2);
	}

	// Let state propagate
	await new Promise((r) => setTimeout(r, 4000));
	printState("State after handover");

	const c = driver.controller;
	if (c.sucNodeId === TARGET_NODE && c.isSUC === false) {
		console.log(
			"\n✓ SUCCESS: HA's primary now reports sucNodeId=110 and is no longer SUC.",
		);
		console.log(
			"   Next step: probe the Pi to confirm it sees itself as SUC/SIS.",
		);
	} else {
		console.warn(
			"\n⚠  State after handover doesn't match expectations — investigate manually.",
		);
	}

	await driver.destroy();
	process.exit(0);
});

console.log(`[start] opening ${PORT}…`);
await driver.start();
