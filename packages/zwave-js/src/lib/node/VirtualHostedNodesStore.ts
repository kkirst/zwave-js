import fsp from "node:fs/promises";
import path from "node:path";
import {
	VirtualHostedNode,
	type VirtualHostedNodePersistence,
} from "./VirtualHostedNode.js";

/**
 * On-disk persistence of the controller's hosted virtual nodes. Written next
 * to the existing zwave-js cache directory, separate from the per-node
 * ValueDB (JsonlDB) infrastructure because virtual-node state has a
 * different lifecycle (no interview, no event-driven attribute writes — at
 * least not in Phases 3-4).
 *
 * Format: a single JSON file `virtual-nodes.json` in the cache directory,
 * containing a `nodes` array of `VirtualHostedNodePersistence` records.
 * Atomic-write via tmp-rename so a mid-write crash never leaves a partial
 * file.
 *
 * Implementation note: uses node:fs/promises directly rather than going
 * through the driver's FileSystem binding, because that binding doesn't
 * expose `rename` / `unlink`. The bridge feature is Node-only anyway.
 */
export const VIRTUAL_NODES_FILENAME = "virtual-nodes.json";

interface FileFormat {
	v: 1;
	nodes: VirtualHostedNodePersistence[];
}

const FORMAT_VERSION = 1;

function filePath(cacheDir: string): string {
	return path.join(cacheDir, VIRTUAL_NODES_FILENAME);
}

/**
 * Read `virtual-nodes.json` from `cacheDir` and return the restored
 * `VirtualHostedNode` instances. Returns an empty list if the file
 * doesn't exist; throws on parse / version mismatch (so callers can log
 * a clear error rather than silently losing state).
 */
export async function loadVirtualNodes(
	cacheDir: string,
): Promise<VirtualHostedNode[]> {
	const p = filePath(cacheDir);
	let text: string;
	try {
		text = await fsp.readFile(p, "utf8");
	} catch (e: any) {
		if (e?.code === "ENOENT") return [];
		throw e;
	}
	const parsed: FileFormat = JSON.parse(text);
	if (parsed.v !== FORMAT_VERSION) {
		throw new Error(
			`virtual-nodes.json: unsupported format version ${parsed.v} (expected ${FORMAT_VERSION})`,
		);
	}
	return parsed.nodes.map((n) => VirtualHostedNode.restoreFromPersistence(n));
}

/**
 * Atomically write the given virtual nodes' state to `virtual-nodes.json`
 * in `cacheDir`. Writes to a `.tmp` file first, then renames into place,
 * so a crash mid-write doesn't corrupt the canonical file.
 *
 * An empty registry writes an empty `nodes: []` file rather than deleting:
 * if `loadVirtualNodes` ever fails for a transient reason (parse error,
 * I/O hiccup) the registry would be empty at shutdown, and a delete-on-empty
 * policy would silently destroy the user's provisioned virtual-node state.
 * Writing an empty file is harmless and trivially small.
 */
export async function saveVirtualNodes(
	cacheDir: string,
	nodes: Iterable<VirtualHostedNode>,
): Promise<void> {
	const arr = Array.from(nodes);
	const target = filePath(cacheDir);
	const payload: FileFormat = {
		v: FORMAT_VERSION,
		nodes: arr.map((n) => n.serializeForPersistence()),
	};
	const tmpPath = target + ".tmp";
	const bytes = JSON.stringify(payload, null, 2);
	await fsp.writeFile(tmpPath, bytes, "utf8");
	await fsp.rename(tmpPath, target);
}
