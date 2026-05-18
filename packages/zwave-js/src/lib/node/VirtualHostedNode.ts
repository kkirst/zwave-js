import { type CommandClass } from "@zwave-js/cc";
import {
	CommandClasses,
	type SecurityClass,
	getCCName,
} from "@zwave-js/core";

/**
 * Built-in NIF profiles a virtual hosted node can advertise. Phase 3+ tooling
 * picks one when provisioning; the inclusion flow uses it to construct the
 * Node Information Frame the radio transmits during virtual-node learn-mode.
 */
export type VirtualHostedNodeProfile = "dimmer" | "binary";

/**
 * Z-Wave Node Information Frame fields a virtual hosted node advertises on
 * the network. Matches the relevant subset of NodeProtocolInfo +
 * Z-Wave Plus Info + supported/controlled CC lists.
 */
export interface VirtualHostedNodeNIF {
	/** Z-Wave basic device class — 0x04 Routing Slave for our use case. */
	basicDeviceClass: number;
	/** Z-Wave generic device class — e.g., 0x11 Multilevel Switch. */
	genericDeviceClass: number;
	/** Z-Wave specific device class — e.g., 0x01 Multilevel Power Switch. */
	specificDeviceClass: number;
	/** CCs this node supports (other nodes may send these TO us). */
	supportedCCs: readonly CommandClasses[];
	/** CCs this node controls (this node may send these to others; sparse). */
	controlledCCs: readonly CommandClasses[];
}

/**
 * One association group this virtual node advertises. Other devices learn
 * about these via the Multi-Channel Association CC's GroupingsGet/Get
 * commands and may add themselves as members via Set/Remove.
 */
export interface VirtualHostedAssociationGroup {
	label: string;
	maxNodes: number;
	isLifeline: boolean;
}

/**
 * Per-virtual-node association membership: which (node, endpoint) pairs are
 * currently associated to which group. Populated by inbound MultiChannel
 * AssociationCC Set/Remove handling (Phase 5).
 */
export interface VirtualHostedAssociationMember {
	nodeId: number;
	endpoint?: number;
}

const BASIC_DEVICE_CLASS_ROUTING_SLAVE = 0x04;
const GENERIC_DEVICE_CLASS_MULTILEVEL_SWITCH = 0x11;
const GENERIC_DEVICE_CLASS_BINARY_SWITCH = 0x10;
const SPECIFIC_DEVICE_CLASS_MULTILEVEL_POWER_SWITCH = 0x01;
const SPECIFIC_DEVICE_CLASS_BINARY_POWER_SWITCH = 0x01;

/**
 * The "Multilevel Dimmer Plus" profile. CCs cover: paddle dim/level reports
 * (MultilevelSwitch + Basic), management (Association + Multi Channel
 * Association + Association Group Info), interrogation (Version + Z-Wave
 * Plus Info + Manufacturer Specific).
 *
 * Note: Security and Security 2 are intentionally OMITTED. A virtual slave
 * hosted on the bridge controller can't truly participate in S2 KEX with
 * other primaries (no shared key material), and advertising S2 support
 * causes those primaries to attempt KEX, then hit an unhandled-rejection
 * crash in their proxyBootstrap path. Paddles associating to this node
 * still encrypt their own outbound commands with the network's S2 keys —
 * the radio (which holds those keys via the SIS) decrypts on the virtual
 * slave's behalf. So omitting S2 from the NIF only skips KEX, not actual
 * over-the-wire encryption.
 */
export const PROFILE_DIMMER: VirtualHostedNodeNIF = {
	basicDeviceClass: BASIC_DEVICE_CLASS_ROUTING_SLAVE,
	genericDeviceClass: GENERIC_DEVICE_CLASS_MULTILEVEL_SWITCH,
	specificDeviceClass: SPECIFIC_DEVICE_CLASS_MULTILEVEL_POWER_SWITCH,
	supportedCCs: [
		CommandClasses.Basic,
		CommandClasses["Multilevel Switch"],
		CommandClasses.Association,
		CommandClasses["Multi Channel Association"],
		CommandClasses["Association Group Information"],
		CommandClasses.Version,
		CommandClasses["Z-Wave Plus Info"],
		CommandClasses["Manufacturer Specific"],
	],
	controlledCCs: [],
};

/**
 * The "Binary Switch Plus" profile. Same management CC stack as dimmer
 * but advertises SwitchBinary instead of MultilevelSwitch.
 */
export const PROFILE_BINARY: VirtualHostedNodeNIF = {
	basicDeviceClass: BASIC_DEVICE_CLASS_ROUTING_SLAVE,
	genericDeviceClass: GENERIC_DEVICE_CLASS_BINARY_SWITCH,
	specificDeviceClass: SPECIFIC_DEVICE_CLASS_BINARY_POWER_SWITCH,
	supportedCCs: [
		CommandClasses.Basic,
		CommandClasses["Binary Switch"],
		CommandClasses.Association,
		CommandClasses["Multi Channel Association"],
		CommandClasses["Association Group Information"],
		CommandClasses.Version,
		CommandClasses["Z-Wave Plus Info"],
		CommandClasses["Manufacturer Specific"],
	],
	controlledCCs: [],
};

export function profileNIF(
	profile: VirtualHostedNodeProfile,
): VirtualHostedNodeNIF {
	return profile === "dimmer" ? PROFILE_DIMMER : PROFILE_BINARY;
}

/** Default Lifeline group every virtual node advertises (group 1). */
export const DEFAULT_LIFELINE_GROUP: VirtualHostedAssociationGroup = {
	label: "Lifeline",
	maxNodes: 5,
	isLifeline: true,
};

/** Persistence schema version. Bump on incompatible format changes. */
const PERSISTENCE_VERSION = 1;

/**
 * Serialized snapshot of a single virtual hosted node — written to disk and
 * round-tripped through `restoreFromPersistence`. Stable JSON layout.
 */
export interface VirtualHostedNodePersistence {
	v: typeof PERSISTENCE_VERSION;
	id: number;
	profile: VirtualHostedNodeProfile;
	associationGroups: Record<string, VirtualHostedAssociationGroup>;
	associations: Record<string, VirtualHostedAssociationMember[]>;
	/**
	 * S2 keys per security class, base64-encoded. Populated by the inclusion
	 * flow in Phase 4. Empty until then.
	 */
	securityKeys: Record<string, string>;
}

/**
 * Represents a Z-Wave end node that the host (Bridge Controller) hosts
 * virtually — i.e., other physical Z-Wave devices on the network may
 * associate with it as a command target. Frames addressed at this NodeID
 * arrive on the host via the Bridge Controller's BridgeApplicationCommand
 * inbound serial-API path, are dispatched here by `Driver.handleRequest`.
 *
 * Distinct from the existing `VirtualNode` (outbound multicast abstraction)
 * — the naming collision is unfortunate but the two classes serve opposite
 * directions of the bridge feature.
 */
export class VirtualHostedNode {
	public readonly id: number;
	public readonly profile: VirtualHostedNodeProfile;
	public readonly nif: VirtualHostedNodeNIF;

	/**
	 * Per-group association membership. Phase 5 wires inbound MultiChannel
	 * AssociationCC Set/Remove handling to mutate this map.
	 */
	public readonly associationGroups = new Map<
		number,
		VirtualHostedAssociationGroup
	>();
	public readonly associations = new Map<
		number,
		VirtualHostedAssociationMember[]
	>();

	/**
	 * S2 keys per security class. Populated during inclusion (Phase 4) when
	 * the SDK firmware reports them via the bridge serial-API callbacks (or
	 * when host-side S2 KEX completes, if we end up needing that).
	 *
	 * Keys are stored as raw bytes here; persisted as base64 (see
	 * `serializeForPersistence`). Encryption-at-rest is a future improvement
	 * — currently relies on file-system permissions on the cache directory.
	 */
	public readonly securityKeys = new Map<SecurityClass, Uint8Array>();

	/**
	 * Test/diagnostic hook: every command dispatched to this virtual node is
	 * appended here so the integration test can assert "the dispatch
	 * reached us". Kept around for the bridgeCommandToVirtualNode test.
	 */
	public readonly receivedCommands: Array<{
		sourceNodeId: number;
		commandClassName: string;
		commandClass: number;
	}> = [];

	/**
	 * The vnode's primary value — the canonical brightness/on-off state the
	 * bridge daemon maintains. For dimmer profile: 0-99 (Z-Wave level scale)
	 * or `undefined` until first set. For binary profile: boolean or
	 * undefined. Mutated via `setValue`.
	 *
	 * This is intentionally simple compared to real ZWaveNode's full ValueDB
	 * — virtual nodes serve one purpose (bulb-group state container) and
	 * don't need the broader CC value-tree machinery.
	 */
	public currentValue: number | boolean | undefined;
	public targetValue: number | boolean | undefined;

	/**
	 * Optional listener fired AFTER `setValue` mutates `currentValue`. The
	 * driver wires this in `loadVirtualNodes` / `register` so it can emit
	 * a "virtual node value updated" event for external consumers (the
	 * @zwave-js/server WS event stream → bridge daemon subscribers).
	 *
	 * Kept as a single optional listener rather than an EventEmitter to keep
	 * VirtualHostedNode dependency-light (no node:events import).
	 */
	public onValueChange?: (
		nodeId: number,
		previous: number | boolean | undefined,
		current: number | boolean | undefined,
	) => void;

	public constructor(id: number, profile: VirtualHostedNodeProfile) {
		this.id = id;
		this.profile = profile;
		this.nif = profileNIF(profile);
		// Every virtual node starts with the standard Lifeline group.
		this.associationGroups.set(1, DEFAULT_LIFELINE_GROUP);
	}

	/**
	 * Mutate the vnode's value. Fires `onValueChange` so external subscribers
	 * (e.g. the driver-level event stream) can observe and forward. Idempotent
	 * — calling with the same value is a no-op (no event fired).
	 */
	public setValue(value: number | boolean | undefined): void {
		if (this.currentValue === value) return;
		const previous = this.currentValue;
		this.currentValue = value;
		this.targetValue = value;
		this.onValueChange?.(this.id, previous, value);
	}

	public async handleCommand(
		sourceNodeId: number,
		command: CommandClass,
	): Promise<void> {
		this.receivedCommands.push({
			sourceNodeId,
			commandClass: command.ccId,
			commandClassName: getCCName(command.ccId),
		});
	}

	/**
	 * Snapshot the virtual node's persistable state for write-to-disk. The
	 * NIF is derived from `profile` so we don't repeat it; the value DB
	 * (Phase 5+) will live in zwave-js's existing ValueDB infrastructure
	 * keyed by `id` and is NOT part of this snapshot.
	 */
	public serializeForPersistence(): VirtualHostedNodePersistence {
		const associationGroups: Record<string, VirtualHostedAssociationGroup> =
			{};
		for (const [gid, info] of this.associationGroups.entries()) {
			associationGroups[String(gid)] = { ...info };
		}
		const associations: Record<
			string,
			VirtualHostedAssociationMember[]
		> = {};
		for (const [gid, members] of this.associations.entries()) {
			associations[String(gid)] = members.map((m) => ({ ...m }));
		}
		const securityKeys: Record<string, string> = {};
		for (const [sc, bytes] of this.securityKeys.entries()) {
			securityKeys[String(sc)] = Buffer.from(bytes).toString("base64");
		}
		return {
			v: PERSISTENCE_VERSION,
			id: this.id,
			profile: this.profile,
			associationGroups,
			associations,
			securityKeys,
		};
	}

	public static restoreFromPersistence(
		data: VirtualHostedNodePersistence,
	): VirtualHostedNode {
		if (data.v !== PERSISTENCE_VERSION) {
			throw new Error(
				`Unsupported virtual-node persistence version ${data.v} (expected ${PERSISTENCE_VERSION})`,
			);
		}
		const node = new VirtualHostedNode(data.id, data.profile);
		// Replace the default Lifeline-only association group with whatever
		// was persisted; rehydrate associations and security keys.
		node.associationGroups.clear();
		for (const [gid, info] of Object.entries(data.associationGroups)) {
			node.associationGroups.set(Number(gid), { ...info });
		}
		for (const [gid, members] of Object.entries(data.associations)) {
			node.associations.set(
				Number(gid),
				members.map((m) => ({ ...m })),
			);
		}
		for (const [scKey, base64] of Object.entries(data.securityKeys)) {
			node.securityKeys.set(
				Number(scKey) as SecurityClass,
				Uint8Array.from(Buffer.from(base64, "base64")),
			);
		}
		return node;
	}
}
