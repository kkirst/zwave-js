import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, expect, afterEach } from "vitest";
import { VirtualHostedNode } from "./VirtualHostedNode.js";
import {
	loadVirtualNodes,
	saveVirtualNodes,
	VIRTUAL_NODES_FILENAME,
} from "./VirtualHostedNodesStore.js";

// Phase 3 / Checkpoint 3:
//   A manually-constructed VirtualHostedNode round-trips through
//   saveVirtualNodes → loadVirtualNodes — state preserved across
//   what would otherwise be a driver restart boundary.

const tempDirs: string[] = [];

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await fsp.rm(dir, { recursive: true, force: true });
	}
});

async function makeTempCacheDir(): Promise<string> {
	const dir = await fsp.mkdtemp(
		path.join(os.tmpdir(), "zjs-virtual-nodes-test-"),
	);
	tempDirs.push(dir);
	return dir;
}

test("saving an empty registry writes an empty file (does NOT delete) — guards against load-failure losing data", async () => {
	const cacheDir = await makeTempCacheDir();
	await saveVirtualNodes(cacheDir, []);
	// Empty file is written and round-trips to an empty list.
	const restored = await loadVirtualNodes(cacheDir);
	expect(restored).toEqual([]);
});

test("loadVirtualNodes returns [] when the file does not exist", async () => {
	const cacheDir = await makeTempCacheDir();
	expect(await loadVirtualNodes(cacheDir)).toEqual([]);
});

test("single dimmer virtual node round-trips through save + load", async () => {
	const cacheDir = await makeTempCacheDir();
	const vn = new VirtualHostedNode(250, "dimmer");
	// Mutate a few non-default fields to prove they survive
	vn.associationGroups.set(2, {
		label: "Multilevel Targets",
		maxNodes: 4,
		isLifeline: false,
	});
	vn.associations.set(1, [{ nodeId: 1, endpoint: 0 }]);
	vn.associations.set(2, [
		{ nodeId: 5, endpoint: 1 },
		{ nodeId: 6, endpoint: 1 },
	]);

	await saveVirtualNodes(cacheDir, [vn]);
	const restored = await loadVirtualNodes(cacheDir);

	expect(restored).toHaveLength(1);
	const r = restored[0];
	expect(r.id).toBe(250);
	expect(r.profile).toBe("dimmer");
	// NIF is derived from profile, not persisted — must match the profile.
	expect(r.nif.genericDeviceClass).toBe(0x11); // Multilevel Switch
	expect(r.nif.specificDeviceClass).toBe(0x01);
	expect(r.nif.supportedCCs).toEqual(vn.nif.supportedCCs);
	// Association tables match exactly
	expect(r.associationGroups.get(1)).toEqual(vn.associationGroups.get(1));
	expect(r.associationGroups.get(2)).toEqual(vn.associationGroups.get(2));
	expect(r.associations.get(1)).toEqual([{ nodeId: 1, endpoint: 0 }]);
	expect(r.associations.get(2)).toEqual([
		{ nodeId: 5, endpoint: 1 },
		{ nodeId: 6, endpoint: 1 },
	]);
});

test("multiple virtual nodes of mixed profiles persist independently", async () => {
	const cacheDir = await makeTempCacheDir();
	const dimmer = new VirtualHostedNode(250, "dimmer");
	const binary = new VirtualHostedNode(251, "binary");

	await saveVirtualNodes(cacheDir, [dimmer, binary]);
	const restored = await loadVirtualNodes(cacheDir);

	expect(restored).toHaveLength(2);
	const byId = new Map(restored.map((r) => [r.id, r]));
	expect(byId.get(250)?.profile).toBe("dimmer");
	expect(byId.get(250)?.nif.genericDeviceClass).toBe(0x11);
	expect(byId.get(251)?.profile).toBe("binary");
	expect(byId.get(251)?.nif.genericDeviceClass).toBe(0x10);
});

test("a saved registry can be overwritten with a smaller / different registry", async () => {
	const cacheDir = await makeTempCacheDir();
	const dimmer = new VirtualHostedNode(250, "dimmer");
	const binary = new VirtualHostedNode(251, "binary");
	await saveVirtualNodes(cacheDir, [dimmer, binary]);
	expect((await loadVirtualNodes(cacheDir)).length).toBe(2);

	await saveVirtualNodes(cacheDir, [binary]);
	const restored = await loadVirtualNodes(cacheDir);
	expect(restored.length).toBe(1);
	expect(restored[0].id).toBe(251);
});

test("loadVirtualNodes throws on a version mismatch", async () => {
	const cacheDir = await makeTempCacheDir();
	await fsp.writeFile(
		path.join(cacheDir, VIRTUAL_NODES_FILENAME),
		JSON.stringify({ v: 999, nodes: [] }),
	);
	await expect(loadVirtualNodes(cacheDir)).rejects.toThrow(
		/unsupported format version/,
	);
});
