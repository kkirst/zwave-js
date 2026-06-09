import fsp from "node:fs/promises";
import path from "node:path";

/**
 * On-disk persistence of REMOTE virtual nodes that THIS controller proxies
 * from a bridge peer (the inverse of {@link VirtualHostedNodesStore}, which
 * persists nodes this controller HOSTS).
 *
 * Why this exists: a Pi bridge peer HOSTS virtual nodes in its radio NVM, so
 * they survive its reboots. But when those vnodes are proxy-included into THIS
 * controller, they live only as in-memory `ZWaveNode` objects — they are never
 * written to this controller's 700-series NVM (the firmware only tracks nodes
 * that were really RF-included). On restart, `Controller.initNodes` rebuilds
 * the node list from the NVM bitmask only, so the proxied vnodes vanish and the
 * bridge-peer-pull re-includes them one-by-one — a slow, churn-heavy storm that
 * overflows the SUC/SIS update buffer.
 *
 * This sidecar lets the fork persist enough metadata to re-materialize each
 * proxied vnode at startup WITHOUT a fresh proxy-inclusion. zwave-js's own value
 * DB also caches these nodes, but only until the next clean save with the node
 * uninstantiated — at which point it prunes them. This file is the fork's own,
 * authoritative record so re-materialization never depends on that fragile cache.
 *
 * IMPORTANT: this store records metadata only. The PEER's live
 * `get_virtual_hosted_nodes` list remains the single source of truth for node
 * *liveness* — a record here for a node the peer no longer hosts is pruned on
 * the next reconcile, never resurrected.
 *
 * Format: a single JSON file `proxy-nodes.json` in the cache directory.
 * Atomic-write via tmp-rename so a mid-write crash never corrupts it.
 */
export const PROXY_NODES_FILENAME = "proxy-nodes.json";

const FORMAT_VERSION = 1;

/** Per-CC interview info captured for faithful re-materialization. */
export interface ProxyCCInfo {
	/** Command class id (e.g. 0x26 Multilevel Switch). */
	id: number;
	/** Interviewed CC version (0 = unknown). */
	version: number;
	/** Whether the CC is accessed securely (S2/S0). */
	secure: boolean;
}

export interface ProxyNodeRecord {
	/** The proxied node's ID (as seen on this controller and the peer). */
	nodeId: number;
	/** The bridge peer WS URL that hosts this vnode (authoritative liveness source). */
	peerUrl: string;
	/** Z-Wave device class — enough to reconstruct the node shell. */
	deviceClass: {
		basic: number;
		generic: number;
		specific: number;
	};
	/** Supported command classes (endpoint 0) — legacy id-only list. */
	supportedCCs: number[];
	/**
	 * Full per-CC interview info (endpoint 0): id + version + secure. This is
	 * what lets re-materialization rebuild the node to its *interviewed* self —
	 * a bare id list loses the CC versions (e.g. Multilevel Switch v4, Binary
	 * Switch v2) and secure flags, leaving hollow v0 CCs with no entities.
	 */
	commandClasses?: ProxyCCInfo[];
	/** Whether the node is always-listening (vnodes are typically non-listening). */
	isListening?: boolean;
	/**
	 * Granted security classes, keyed by SecurityClass enum member name
	 * (e.g. "S2_Authenticated"), value = granted boolean. Restored so the
	 * re-materialized node talks S2 with the network keys without a re-bootstrap.
	 */
	securityClasses: Record<string, boolean>;
	/** Bridge profile hint ("dimmer" | "binary"), informational. */
	profile?: string;
}

interface FileFormat {
	v: number;
	nodes: ProxyNodeRecord[];
}

function filePath(cacheDir: string): string {
	return path.join(cacheDir, PROXY_NODES_FILENAME);
}

/**
 * Read `proxy-nodes.json` from `cacheDir`. Returns an empty array if the file
 * doesn't exist; throws on parse / version mismatch so callers can log clearly
 * rather than silently losing state.
 */
export async function loadProxyNodes(
	cacheDir: string,
): Promise<ProxyNodeRecord[]> {
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
			`proxy-nodes.json: unsupported format version ${parsed.v} (expected ${FORMAT_VERSION})`,
		);
	}
	return Array.isArray(parsed.nodes) ? parsed.nodes : [];
}

/**
 * Atomically write the given proxy-node records to `proxy-nodes.json` in
 * `cacheDir`. Writes to a `.tmp` file first, then renames into place.
 *
 * An empty set writes an empty `nodes: []` file rather than deleting, so a
 * transient load failure can't trigger a delete-on-empty that destroys state.
 */
export async function saveProxyNodes(
	cacheDir: string,
	records: Iterable<ProxyNodeRecord>,
): Promise<void> {
	const arr = Array.from(records);
	const target = filePath(cacheDir);
	const payload: FileFormat = { v: FORMAT_VERSION, nodes: arr };
	const tmpPath = target + ".tmp";
	await fsp.writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf8");
	await fsp.rename(tmpPath, target);
}
