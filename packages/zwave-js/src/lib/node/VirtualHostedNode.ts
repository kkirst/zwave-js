import {
	AssociationCCGet,
	AssociationCCRemove,
	AssociationCCReport,
	AssociationCCSet,
	AssociationCCSupportedGroupingsGet,
	AssociationCCSupportedGroupingsReport,
	AssociationGroupInfoCCCommandListGet,
	AssociationGroupInfoCCCommandListReport,
	AssociationGroupInfoCCInfoGet,
	AssociationGroupInfoCCInfoReport,
	AssociationGroupInfoCCNameGet,
	AssociationGroupInfoCCNameReport,
	AssociationGroupInfoProfile,
	BasicCCSet,
	BinarySwitchCCGet,
	BinarySwitchCCReport,
	MultilevelSwitchCCGet,
	MultilevelSwitchCCReport,
	MultilevelSwitchCCSet,
	type CommandClass,
	ManufacturerSpecificCCGet,
	ManufacturerSpecificCCReport,
	MultiChannelAssociationCCGet,
	MultiChannelAssociationCCRemove,
	MultiChannelAssociationCCReport,
	MultiChannelAssociationCCSet,
	MultiChannelAssociationCCSupportedGroupingsGet,
	MultiChannelAssociationCCSupportedGroupingsReport,
	MultiChannelCCEndPointGet,
	MultiChannelCCEndPointReport,
	NoOperationCC,
	Security2CCCommandsSupportedGet,
	Security2CCCommandsSupportedReport,
	Security2CCNonceGet,
	Security2CCNonceReport,
	VersionCCCommandClassGet,
	VersionCCCommandClassReport,
	VersionCCGet,
	VersionCCReport,
	ZWavePlusCCGet,
	ZWavePlusCCReport,
	ZWavePlusNodeType,
	ZWavePlusRoleType,
} from "@zwave-js/cc";
import {
	CommandClasses,
	SecurityClass,
	SecurityManager2,
	ZWaveLibraryTypes,
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
 * Plus Info + Manufacturer Specific), plus Security 0/2.
 *
 * Security CCs are advertised so HA stores correct NodeProtocolInfo for the
 * vnode AND so the proxyBootstrap KEX-failure fallback (Controller.ts) can
 * trigger and grant S2_Authenticated via proxy-bridge trust. Without S2 in
 * the NIF, HA stores wrong NodeProtocolInfo (isListening=false, etc); with
 * S2 in NIF + KEX-failure fallback, both correct NodeProtocolInfo AND
 * S2_Authenticated grant happen. The vnode never needs to actually decrypt
 * S2 frames at the application layer — the radio handles it.
 */
export const PROFILE_DIMMER: VirtualHostedNodeNIF = {
	basicDeviceClass: BASIC_DEVICE_CLASS_ROUTING_SLAVE,
	genericDeviceClass: GENERIC_DEVICE_CLASS_MULTILEVEL_SWITCH,
	specificDeviceClass: SPECIFIC_DEVICE_CLASS_MULTILEVEL_POWER_SWITCH,
	supportedCCs: [
		CommandClasses.Basic,
		CommandClasses["Multilevel Switch"],
		// Binary Switch advertised alongside Multilevel so the vnode can act
		// as a virtual relay (group 3 → paddle EP2) AND a virtual dimmer
		// (group 2 → paddle EP1 LED). Mirrors how a ZEN30 paddle exposes
		// both endpoints from a single physical device.
		CommandClasses["Binary Switch"],
		CommandClasses.Association,
		CommandClasses["Multi Channel Association"],
		CommandClasses["Association Group Information"],
		CommandClasses.Version,
		CommandClasses["Z-Wave Plus Info"],
		CommandClasses["Manufacturer Specific"],
		CommandClasses.Security,
		CommandClasses["Security 2"],
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
		CommandClasses.Security,
		CommandClasses["Security 2"],
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

/**
 * Group 2 on every vnode: "MultilevelSwitch Set Group". Members of this
 * group receive `MultilevelSwitchCC.Set` whenever the vnode's currentValue
 * changes (driven by the bridge daemon writing matter state via setValue).
 *
 * Mirrors the pattern a real ZEN30 dimmer EP exposes (its own group 3,
 * "MULTILEVEL SET Group", issuedCommands {MultilevelSwitch: [Set]}). Users
 * add their target paddle dimmer endpoints to this group via HA's
 * zwave-js-ui frontend; the vnode auto-pushes Sets to them on every
 * value change over the vnode-to-paddle S2 SPAN (peer-to-peer, fast).
 */
export const DEFAULT_MULTILEVEL_SET_GROUP: VirtualHostedAssociationGroup = {
	label: "MultilevelSwitch Set Group",
	maxNodes: 5,
	isLifeline: false,
};

/** Group ID for the MultilevelSwitch Set Group. */
export const MULTILEVEL_SET_GROUP_ID = 2;

/**
 * Group 3 on every dimmer-profile vnode: "BinarySwitch Set Group". Members
 * receive `BinarySwitchCC.Set` whenever the vnode's `currentBinaryValue`
 * changes (driven by the bridge daemon's power state machine via
 * `setBinaryValue`).
 *
 * Mirrors group 2's pattern but for the binary CC, enabling the vnode to
 * act as a "virtual relay": users add the paddle's relay endpoint (EP2 on
 * a ZEN30) to this group via HA's zwave-js-ui frontend; the vnode pushes
 * binary Sets to it on every state-machine transition that opens or closes
 * the relay.
 */
export const DEFAULT_BINARY_SET_GROUP: VirtualHostedAssociationGroup = {
	label: "BinarySwitch Set Group",
	maxNodes: 5,
	isLifeline: false,
};

/** Group ID for the BinarySwitch Set Group. */
export const BINARY_SET_GROUP_ID = 3;

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
	 * Virtual-relay state, separate from `currentValue` (which is the dimmer
	 * level). `true` = relay closed (bulbs powered); `false` = relay open
	 * (bulbs unpowered); `undefined` = never set. Mutated via
	 * `setBinaryValue`.
	 *
	 * The two values are decoupled on purpose: the bridge daemon's power
	 * state machine drives `currentBinaryValue` (matter intent →
	 * relay open/close), while the matter mirror drives `currentValue`
	 * (matter brightness slider → LED feedback). A bulb's brightness can
	 * be 99 even while the relay is open — the LED reflects matter intent;
	 * the actual bulbs simply aren't powered yet.
	 */
	public currentBinaryValue: boolean | undefined;
	public targetBinaryValue: boolean | undefined;

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

	/**
	 * Optional listener fired AFTER `setBinaryValue` mutates
	 * `currentBinaryValue`. Mirrors `onValueChange` but for the binary
	 * relay state. The driver wires this to emit a distinct
	 * "virtual node binary value updated" event for external consumers.
	 */
	public onBinaryValueChange?: (
		nodeId: number,
		previous: boolean | undefined,
		current: boolean | undefined,
	) => void;

	/**
	 * Optional listener fired after `handleCommand` mutates persistable state
	 * (currently: associations Set/Remove). Driver wires this in
	 * `registerVirtualHostedNode` so it can flush the virtual-nodes cache
	 * to disk without VirtualHostedNode depending on the driver directly.
	 */
	public onPersistableChange?: (nodeId: number) => void;

	/**
	 * Sends a CommandClass FROM this virtual node TO the destination
	 * encoded in `command.nodeId`. Wired by the driver in
	 * `registerVirtualHostedNode` to `controller.sendCommandFromVirtualNode`.
	 * Keeps VirtualHostedNode decoupled from the driver — the vnode just
	 * knows "I have a sender; use it to emit frames".
	 *
	 * Used by `setValue` to auto-broadcast `MultilevelSwitchCC.Set` to
	 * MultilevelSwitch Set Group members on every value change.
	 */
	public sender?: (
		vnodeId: number,
		command: CommandClass,
	) => Promise<void>;

	/**
	 * Per-vnode S2 manager. The vnode acts as the "slave" end of S2:
	 * tracks SPAN state per peer (mainly HA), holds the network keys
	 * cloned from the Driver's manager at registration time. Without
	 * this, every encrypted query from HA fails to decrypt because the
	 * Driver's own SPAN state with HA doesn't match HA's SPAN with the
	 * vnode (they're separate node-pair conversations).
	 *
	 * Initialized async by Driver.registerVirtualHostedNode. Until then,
	 * S2 NonceGet handling is a no-op (and HA will eventually give up).
	 */
	public sm2: SecurityManager2 | undefined;

	public constructor(id: number, profile: VirtualHostedNodeProfile) {
		this.id = id;
		this.profile = profile;
		this.nif = profileNIF(profile);
		// Every virtual node starts with the standard Lifeline group +
		// the MultilevelSwitch Set Group (group 2). Users add their target
		// paddle endpoints to group 2 via HA's zwave-js-ui frontend; the
		// vnode auto-pushes Sets to them on every value change.
		this.associationGroups.set(1, DEFAULT_LIFELINE_GROUP);
		this.associationGroups.set(
			MULTILEVEL_SET_GROUP_ID,
			DEFAULT_MULTILEVEL_SET_GROUP,
		);
		// Group 3 only exists on dimmer-profile vnodes (which advertise both
		// MultilevelSwitch and BinarySwitch CCs). On a pure binary-profile
		// vnode, the binary CC sits on group 2 instead.
		if (profile === "dimmer") {
			this.associationGroups.set(
				BINARY_SET_GROUP_ID,
				DEFAULT_BINARY_SET_GROUP,
			);
		}
	}

	/**
	 * Coherent current level (0..99) for MultilevelSwitch reports. Falls back
	 * to the binary relay state (on=99 / off=0) when no level has been set, so
	 * the value never reads "unknown" on the primary's UI.
	 */
	private _effectiveLevel(): number {
		if (typeof this.currentValue === "number") return this.currentValue;
		if (this.currentBinaryValue != null) {
			return this.currentBinaryValue ? 99 : 0;
		}
		return 0;
	}

	/**
	 * Coherent on/off for BinarySwitch reports. Falls back to level>0 when no
	 * binary state has been set.
	 */
	private _effectiveBinaryValue(): boolean {
		if (this.currentBinaryValue != null) return this.currentBinaryValue;
		if (typeof this.currentValue === "number") return this.currentValue > 0;
		return false;
	}

	/**
	 * Send an unsolicited `BinarySwitchCC.Report` to the Lifeline (group 1)
	 * members — i.e. HA's primary — so zwave-js-ui reflects the binary/relay
	 * state live instead of only on a Get/refresh. Binary state ONLY: the
	 * level channel stays query-driven so we don't reintroduce the per-tick
	 * lifeline traffic the Phase-5d pull model removed (adaptive levels churn;
	 * relay/binary state changes are infrequent). Fire-and-forget; the sender
	 * auto-encrypts to the primary's S2 class (same path as the group-3
	 * broadcast). No-op when the lifeline has no members.
	 */
	private async _reportBinaryToLifeline(
		value: boolean | undefined,
	): Promise<void> {
		if (this.sender == null || value == null) return;
		const members = this.associations.get(1);
		if (members == null || members.length === 0) return;
		const bsMod: any = await import("@zwave-js/cc/BinarySwitchCC");
		const sends: Promise<unknown>[] = [];
		for (const m of members) {
			sends.push(
				this.sender!(
					this.id,
					new bsMod.BinarySwitchCCReport({
						nodeId: m.nodeId,
						endpointIndex: 0,
						currentValue: value,
					}),
				),
			);
		}
		await Promise.allSettled(sends);
	}

	/**
	 * Mutate the vnode's value AND auto-broadcast `MultilevelSwitchCC.Set`
	 * to every member of the MultilevelSwitch Set Group (group 2). Mirrors
	 * how a real ZEN30 dimmer endpoint behaves: its own value change pushes
	 * Sets to its group-3 associated targets natively.
	 *
	 * Fires `onValueChange` for external state-tracking subscribers (driver
	 * forwards as a "virtual node value updated" event). Idempotent —
	 * calling with the same value is a no-op (no event, no broadcast).
	 *
	 * Async because the broadcast goes over the wire; callers can `await`
	 * to know when frames have been queued. The actual S2-encrypted radio
	 * transmission is fire-and-forget once handed off to the controller.
	 */
	public async setValue(
		value: number | boolean | undefined,
	): Promise<void> {
		if (this.currentValue === value) return;
		const previous = this.currentValue;
		this.currentValue = value;
		this.targetValue = value;
		this.onValueChange?.(this.id, previous, value);
		await this._broadcastValueChange(value);
	}

	/**
	 * Apply an INBOUND MultilevelSwitch.Set from a paddle/dimmer
	 * associated to this vnode. Updates the value + fires onValueChange
	 * (-> "virtual node value updated" for the bridge daemon) but does
	 * NOT re-broadcast: the sender already holds this level, and the
	 * daemon's Shelly-confirmed correction owns LED feedback. Idempotent.
	 */
	public setValueFromInbound(value: number | undefined): void {
		if (this.currentValue === value) return;
		const previous = this.currentValue;
		this.currentValue = value;
		this.targetValue = value;
		this.onValueChange?.(this.id, previous, value);
	}

	/**
	 * Iterate the MultilevelSwitch Set Group's members and dispatch a
	 * `MultilevelSwitchCC.Set` to each. Used by `setValue`.
	 *
	 * Skips silently if:
	 *  - No sender is wired (vnode not registered yet)
	 *  - No members in the group (user hasn't configured associations)
	 *  - Value is `undefined` (can't encode as a level)
	 *  - Profile is binary (would need BinarySwitchCCSet instead — not
	 *    yet wired, left as a TODO for binary-profile rollout)
	 *
	 * Members with no endpoint default to root (0). Members with an
	 * endpoint route via MultiChannel encapsulation (zwave-js handles this
	 * automatically when `endpointIndex` is non-zero).
	 */
	private async _broadcastValueChange(
		value: number | boolean | undefined,
		excludeNodeId?: number,
	): Promise<void> {
		if (this.sender == null) return;
		if (value == null) return;
		const allMembers = this.associations.get(MULTILEVEL_SET_GROUP_ID);
		if (allMembers == null || allMembers.length === 0) return;
		if (this.profile !== "dimmer") return;
		// Exclude the source paddle on a mirror (it already holds the level;
		// re-sending risks an echo loop). Undefined => broadcast to all.
		const members = excludeNodeId != null
			? allMembers.filter((m) => m.nodeId !== excludeNodeId)
			: allMembers;
		if (members.length === 0) return;
		const targetValue = typeof value === "boolean"
			? (value ? 99 : 0)
			: Math.max(0, Math.min(99, Math.round(value)));
		// Late-import to avoid a top-level cycle with @zwave-js/cc.
		const ccMod: any = await import("@zwave-js/cc/MultilevelSwitchCC");
		const mcMod: any = await import("@zwave-js/cc/MultiChannelCC");
		await Promise.allSettled(
			members.map((m) => {
				const inner = new ccMod.MultilevelSwitchCCSet({
					nodeId: m.nodeId,
					endpointIndex: 0,
					targetValue,
					duration: 0,
				});
				// Endpoint > 0 targets must be MultiChannelCC-encapsulated.
				// `sendCommandFromVirtualNode` doesn't auto-wrap, so without
				// this the frame lands at the destination's root endpoint —
				// observed 2026-05-19 to make a Zooz ZEN30's relay toggle on
				// every dimmer Set because root endpoint mirrors a combined
				// view across both endpoints.
				const cc = m.endpoint != null && m.endpoint > 0
					? new mcMod.MultiChannelCCCommandEncapsulation({
						nodeId: m.nodeId,
						endpointIndex: 0,
						encapsulated: inner,
						destination: m.endpoint,
					})
					: inner;
				return this.sender!(this.id, cc);
			}),
		);
	}

	/**
	 * Mutate the vnode's binary state AND auto-broadcast `BinarySwitchCC.Set`
	 * to every member of the BinarySwitch Set Group (group 3). Used by the
	 * bridge daemon's power state machine to drive the paddle relay open
	 * or closed.
	 *
	 * NOT idempotent on the broadcast side — unlike `setValue` (multilevel),
	 * `setBinaryValue` ALWAYS broadcasts even when the cached value is
	 * unchanged. The binary value represents *intent* to drive the paddle
	 * relay (PSM "I want it closed right now"); the cached state can be
	 * stale if the relay was toggled externally (e.g. local paddle tap).
	 * Without an unconditional broadcast, a stale-cached True would cause
	 * the next PSM ARMING transition to no-op silently, leaving the relay
	 * open and the intercede flow stuck. `onBinaryValueChange` still only
	 * fires on actual mutations so external listeners aren't spammed.
	 */
	public async setBinaryValue(value: boolean | undefined): Promise<void> {
		const changed = this.currentBinaryValue !== value;
		const previous = this.currentBinaryValue;
		this.currentBinaryValue = value;
		this.targetBinaryValue = value;
		if (changed) {
			this.onBinaryValueChange?.(this.id, previous, value);
			// Live-update the primary's UI with the new relay/binary state.
			void this._reportBinaryToLifeline(value);
		}
		await this._broadcastBinaryValueChange(value);
	}

	/**
	 * Iterate the BinarySwitch Set Group's members and dispatch a
	 * `BinarySwitchCC.Set` to each. Used by `setBinaryValue`.
	 *
	 * Only runs for dimmer-profile vnodes (binary-profile vnodes use
	 * group 2 instead and go through `setValue`). Members with no endpoint
	 * default to root (0); endpoint-aware members route via MultiChannel.
	 */
	private async _broadcastBinaryValueChange(
		value: boolean | undefined,
	): Promise<void> {
		if (this.sender == null) return;
		if (value == null) return;
		if (this.profile !== "dimmer") return;
		const members = this.associations.get(BINARY_SET_GROUP_ID);
		if (members == null || members.length === 0) return;
		const bsMod: any = await import("@zwave-js/cc/BinarySwitchCC");
		const mlMod: any = await import("@zwave-js/cc/MultilevelSwitchCC");
		const mcMod: any = await import("@zwave-js/cc/MultiChannelCC");
		// The binary/relay value travels two ways so group-3 targets of
		// either type are driven: BinarySwitch.Set for relays, and
		// MultilevelSwitch.Set(0/99) for dimmers configured as instant 0/99
		// relays (e.g. ZEN72) that lack a Binary Switch CC. Each target acts
		// on whichever CC it supports; the other is ignored at the CC layer.
		const level = value ? 99 : 0;
		const wrap = (m: any, inner: any) =>
			m.endpoint != null && m.endpoint > 0
				? new mcMod.MultiChannelCCCommandEncapsulation({
					nodeId: m.nodeId,
					endpointIndex: 0,
					encapsulated: inner,
					destination: m.endpoint,
				})
				: inner;
		const sends: Promise<unknown>[] = [];
		for (const m of members) {
			sends.push(this.sender!(this.id, wrap(m, new bsMod.BinarySwitchCCSet({
				nodeId: m.nodeId, endpointIndex: 0, targetValue: value,
			}))));
			sends.push(this.sender!(this.id, wrap(m, new mlMod.MultilevelSwitchCCSet({
				nodeId: m.nodeId, endpointIndex: 0, targetValue: level, duration: 0,
			}))));
		}
		await Promise.allSettled(sends);
	}

	/**
	 * Phase 5: handle an inbound CC and return the response CC the Driver
	 * should send back (or `undefined` if no response is expected). The
	 * Driver wraps the response in a `SendDataBridge` so the destination
	 * sees it as coming from THIS virtual node.
	 *
	 * Coverage prioritized for HA's zwave-js-ui workflow:
	 *
	 *   - AssociationCC + MultiChannelAssociationCC: SupportedGroupingsGet,
	 *     Get, Set, Remove — the UI's group panel reads/writes through
	 *     these.
	 *   - AssociationGroupInfoCC: NameGet, InfoGet, CommandListGet — give
	 *     the UI a label + profile + issued-commands list per group so the
	 *     group dropdown is meaningful.
	 *   - VersionCC, ManufacturerSpecificCC, ZWavePlusCC: minimum
	 *     interview-completion responses; without them HA may keep the
	 *     vnode in an "interview pending" state that gates association
	 *     editing in the UI.
	 *   - MultiChannelCC.EndPointGet: respond "no endpoints" (vnodes are
	 *     single-endpoint).
	 *   - NoOperationCC: eat silently.
	 *
	 * Unhandled CCs fall through with no response — they remain logged in
	 * `receivedCommands` for diagnostic visibility.
	 */
	public async handleCommand(
		sourceNodeId: number,
		command: CommandClass,
	): Promise<CommandClass | undefined> {
		this.receivedCommands.push({
			sourceNodeId,
			commandClass: command.ccId,
			commandClassName: getCCName(command.ccId),
		});

		const addr = { nodeId: sourceNodeId, endpointIndex: 0 } as const;

		// ─── AssociationCC ────────────────────────────────────────────────
		if (command instanceof AssociationCCSupportedGroupingsGet) {
			return new AssociationCCSupportedGroupingsReport({
				...addr,
				groupCount: this.associationGroups.size,
			});
		}
		if (command instanceof AssociationCCGet) {
			const group = this.associationGroups.get(command.groupId);
			const members = this.associations.get(command.groupId) ?? [];
			return new AssociationCCReport({
				...addr,
				groupId: command.groupId,
				maxNodes: group?.maxNodes ?? 0,
				// Plain AssociationCC reports only node-only members
				// (no endpoint info) — endpoint-aware membership flows
				// through MultiChannelAssociationCC.
				nodeIds: members
					.filter((m) => m.endpoint == null)
					.map((m) => m.nodeId),
				reportsToFollow: 0,
			});
		}
		if (command instanceof AssociationCCSet) {
			const existing = this.associations.get(command.groupId) ?? [];
			const additions = command.nodeIds
				.filter(
					(nid) =>
						!existing.some(
							(m) =>
								m.endpoint == null && m.nodeId === nid,
						),
				)
				.map((nid) => ({ nodeId: nid }));
			if (additions.length > 0) {
				this.associations.set(command.groupId, [
					...existing,
					...additions,
				]);
				this.onPersistableChange?.(this.id);
			}
			return undefined;
		}
		if (command instanceof AssociationCCRemove) {
			this._removeAssociations(
				command.groupId,
				command.nodeIds ?? [],
				/* endpointAware */ false,
			);
			return undefined;
		}

		// ─── MultiChannelAssociationCC ────────────────────────────────────
		if (command instanceof MultiChannelAssociationCCSupportedGroupingsGet) {
			return new MultiChannelAssociationCCSupportedGroupingsReport({
				...addr,
				groupCount: this.associationGroups.size,
			});
		}
		if (command instanceof MultiChannelAssociationCCGet) {
			const group = this.associationGroups.get(command.groupId);
			const members = this.associations.get(command.groupId) ?? [];
			return new MultiChannelAssociationCCReport({
				...addr,
				groupId: command.groupId,
				maxNodes: group?.maxNodes ?? 0,
				nodeIds: members
					.filter((m) => m.endpoint == null)
					.map((m) => m.nodeId),
				endpoints: members
					.filter((m) => m.endpoint != null)
					.map((m) => ({
						nodeId: m.nodeId,
						endpoint: m.endpoint!,
					})),
				reportsToFollow: 0,
			});
		}
		if (command instanceof MultiChannelAssociationCCSet) {
			const existing = this.associations.get(command.groupId) ?? [];
			const additions: VirtualHostedAssociationMember[] = [];
			for (const nid of command.nodeIds ?? []) {
				if (
					!existing.some(
						(m) => m.endpoint == null && m.nodeId === nid,
					)
				) {
					additions.push({ nodeId: nid });
				}
			}
			for (const ep of command.endpoints ?? []) {
				const epIdx = typeof ep.endpoint === "number"
					? ep.endpoint
					: undefined;
				if (epIdx == null) continue;
				if (
					!existing.some(
						(m) =>
							m.endpoint === epIdx
							&& m.nodeId === ep.nodeId,
					)
				) {
					additions.push({
						nodeId: ep.nodeId,
						endpoint: epIdx,
					});
				}
			}
			if (additions.length > 0) {
				this.associations.set(command.groupId, [
					...existing,
					...additions,
				]);
				this.onPersistableChange?.(this.id);
			}
			return undefined;
		}
		if (command instanceof MultiChannelAssociationCCRemove) {
			const epPairs: VirtualHostedAssociationMember[] = [];
			for (const ep of command.endpoints ?? []) {
				const epIdx = typeof ep.endpoint === "number"
					? ep.endpoint
					: undefined;
				if (epIdx == null) continue;
				epPairs.push({ nodeId: ep.nodeId, endpoint: epIdx });
			}
			this._removeAssociations(
				command.groupId,
				command.nodeIds ?? [],
				/* endpointAware */ true,
				epPairs,
			);
			return undefined;
		}

		// ─── AssociationGroupInfoCC ───────────────────────────────────────
		if (command instanceof AssociationGroupInfoCCNameGet) {
			const group = this.associationGroups.get(command.groupId);
			return new AssociationGroupInfoCCNameReport({
				...addr,
				groupId: command.groupId,
				name: group?.label ?? `Group ${command.groupId}`,
			});
		}
		if (command instanceof AssociationGroupInfoCCInfoGet) {
			// listMode requests info about ALL groups in one report; targeted
			// requests one specific groupId. A targeted Get with undefined
			// groupId is malformed — fall back to an empty list.
			const groupIds: number[] = command.listMode
				? Array.from(this.associationGroups.keys())
				: command.groupId != null
				? [command.groupId]
				: [];
			return new AssociationGroupInfoCCInfoReport({
				...addr,
				isListMode: command.listMode ?? false,
				hasDynamicInfo: false,
				groups: groupIds.map((gid) => {
					const g = this.associationGroups.get(gid);
					const profile = g?.isLifeline
						? AssociationGroupInfoProfile["General: Lifeline"]
						: gid === MULTILEVEL_SET_GROUP_ID
						? AssociationGroupInfoProfile["Control: Key 01"]
						: gid === BINARY_SET_GROUP_ID
						? AssociationGroupInfoProfile["Control: Key 01"]
						: AssociationGroupInfoProfile["General: N/A"];
					return {
						groupId: gid,
						mode: 0,
						profile,
						eventCode: 0,
					};
				}),
			});
		}
		if (command instanceof AssociationGroupInfoCCCommandListGet) {
			// Per-group "issued commands" advertisement — the UI shows this
			// as "this group sends: …".
			//   Group 1 (Lifeline): unsolicited MultilevelSwitch/BinarySwitch
			//     + Basic Reports (the bridge daemon emits these via
			//     sendCommandFromVirtualNode as a Report when wanted).
			//   Group 2 (MultilevelSwitch Set Group): MultilevelSwitch.Set
			//     auto-pushed by VirtualHostedNode.setValue() on every
			//     value mutation. Mirrors paddle 71 EP 1 group 3's
			//     issuedCommands {38: [Set]} declaration.
			const commands = new Map<CommandClasses, readonly number[]>();
			if (command.groupId === 1) {
				if (this.profile === "dimmer") {
					commands.set(CommandClasses["Multilevel Switch"], [
						0x03,
					]); // Report
				} else {
					commands.set(CommandClasses["Binary Switch"], [0x03]);
				}
				commands.set(CommandClasses.Basic, [0x03]);
			} else if (command.groupId === MULTILEVEL_SET_GROUP_ID) {
				if (this.profile === "dimmer") {
					commands.set(CommandClasses["Multilevel Switch"], [
						0x01,
					]); // Set
				} else {
					commands.set(CommandClasses["Binary Switch"], [0x01]);
				}
			} else if (command.groupId === BINARY_SET_GROUP_ID) {
				// Group 3 carries the vnode's binary/relay intent. It issues
				// BinarySwitch.Set for relay targets AND MultilevelSwitch.Set
				// for dimmers configured as instant 0/99 relays (e.g. ZEN72)
				// that have no Binary Switch CC — the on/off value travels as a
				// level (0=off, 99=on). Advertising both lets zwave-js-ui allow
				// either device type as a group-3 association target.
				commands.set(CommandClasses["Binary Switch"], [0x01]); // Set
				commands.set(CommandClasses["Multilevel Switch"], [0x01]); // Set
			}
			return new AssociationGroupInfoCCCommandListReport({
				...addr,
				groupId: command.groupId,
				commands,
			});
		}

		// ─── VersionCC ────────────────────────────────────────────────────
		if (command instanceof VersionCCGet) {
			return new VersionCCReport({
				...addr,
				libraryType: ZWaveLibraryTypes["Routing Slave"],
				protocolVersion: "7.22",
				firmwareVersions: ["1.0"],
				hardwareVersion: 1,
			});
		}
		if (command instanceof VersionCCCommandClassGet) {
			return new VersionCCCommandClassReport({
				...addr,
				requestedCC: command.requestedCC,
				ccVersion: this._ccVersionForReport(command.requestedCC),
			});
		}

		// ─── BinarySwitchCC.Get / MultilevelSwitchCC.Get ────────────────
		// The primary (HA zwave-js-ui) sends these during interview, on
		// "Refresh Values", and on poll. Without a Report reply the value
		// stays "unknown" in the UI. Report the vnode's current state,
		// cross-derived so both CCs read coherently regardless of which
		// channel the daemon drives (group-2 level vs group-3 binary).
		if (command instanceof BinarySwitchCCGet) {
			return new BinarySwitchCCReport({
				...addr,
				currentValue: this._effectiveBinaryValue(),
			});
		}
		if (command instanceof MultilevelSwitchCCGet) {
			return new MultilevelSwitchCCReport({
				...addr,
				currentValue: this._effectiveLevel(),
			});
		}

		// ─── BinarySwitchCC.Report  (Task #48) ───────────────────────────
		// Inbound binary-state Report from a paddle/relay associated to
		// this vnode (e.g. lifeline or a dedicated group). Mirrors the
		// reported state into `currentBinaryValue`; fires
		// `onBinaryValueChange` which the Driver lifts to a
		// "virtual node binary value updated" event for the bridge daemon.
		// Returns no response — Reports are unsolicited and don't ACK at
		// the CC layer (the SupervisionCC envelope, if present, gets a
		// Success response from the standard handler).
		if (command instanceof BinarySwitchCCReport) {
			const v = (command as any).currentValue;
			if (typeof v === "boolean") {
				await this.setBinaryValue(v);
			}
			return undefined;
		}

		// ─── BasicCC.Set  (Task #48) ─────────────────────────────────────
		// Legacy paddles (notably the Zen51 in supervised mode) emit
		// BasicCC.Set rather than BinarySwitchCC.Report on lifeline. The
		// target value is 0 for OFF, 0xFF for "restore to last on level"
		// (treated as ON here), or any 0..99 value for dimming intent.
		// For our binary-meaning vnodes, any non-zero target = ON.
		if (command instanceof BasicCCSet) {
			const t = (command as any).targetValue;
			if (typeof t === "number") {
				await this.setBinaryValue(t > 0);
			}
			return undefined;
		}

		// MultilevelSwitchCC.Set (vnode-as-input): a dimmer paddle endpoint
		// associated to this vnode's MultilevelSwitch Set Group reports the
		// level the user dialed in. Mirror it into the vnode value (fires
		// "virtual node value updated"; the daemon snaps level->state and
		// drives RF). 0xFF = restore-to-last -> treat as full (99). No
		// re-broadcast (see setValueFromInbound). Rides the warm
		// vnode<->paddle peer SPAN = low-latency input path.
		if (command instanceof MultilevelSwitchCCSet) {
			const tv = (command as any).targetValue;
			if (typeof tv === "number") {
				const level = tv === 0xff ? 99 : tv;
				this.setValueFromInbound(level);
				// Mirror the dialed level to the OTHER members of the
				// MultilevelSwitch Set Group (paddle LED feedback), excluding the
				// source paddle (it already holds this level locally; echoing
				// back risks a loop). Native multi-paddle dimmer-association
				// behaviour. Fire-and-forget so the input path adds no latency;
				// the daemon's Shelly-confirmed write still corrects to canonical.
				void this._broadcastValueChange(level, sourceNodeId);
			}
			return undefined;
		}

		// ─── ManufacturerSpecificCC ───────────────────────────────────────
		if (command instanceof ManufacturerSpecificCCGet) {
			return new ManufacturerSpecificCCReport({
				...addr,
				// Zooz manufacturer id (0x0312) is a polite placeholder
				// since the bridge daemon is hosted on Zooz silicon. Product
				// type/id are arbitrary internal identifiers.
				manufacturerId: 0x0312,
				productType: 0xbeef,
				productId: this.profile === "dimmer" ? 0x0001 : 0x0002,
			});
		}

		// ─── ZWavePlusCC ──────────────────────────────────────────────────
		if (command instanceof ZWavePlusCCGet) {
			return new ZWavePlusCCReport({
				...addr,
				zwavePlusVersion: 2,
				nodeType: ZWavePlusNodeType.Node,
				roleType: ZWavePlusRoleType.AlwaysOnSlave,
				installerIcon: 0x0000,
				userIcon: 0x0000,
			});
		}

		// ─── MultiChannelCC (endpoint discovery) ──────────────────────────
		if (command instanceof MultiChannelCCEndPointGet) {
			return new MultiChannelCCEndPointReport({
				...addr,
				countIsDynamic: false,
				identicalCapabilities: true,
				individualCount: 0,
				aggregatedCount: 0,
			});
		}

		// ─── Security2CCNonceGet (S2 SPAN bootstrap, Phase 4c) ───────────
		// HA initiates an S2 SPAN with the vnode by sending NonceGet before
		// any encrypted CC query. We generate a Singlecast PAN nonce (REI)
		// using the vnode's own SecurityManager2 — separate from the
		// Driver's manager so HA ↔ vnode SPAN state doesn't collide with
		// HA ↔ Driver SPAN state. The vnode's sm2 holds the network keys
		// (cloned at register time) so the SPAN can derive correct AES-CCM
		// keys for subsequent encrypted frames.
		//
		// SOS=true (Sender includes Sender's EI), MOS=false (no multicast
		// out of sync). After this report, HA can encrypt CCs to us using
		// the SPAN; subsequent Security2CCMessageEncapsulation frames
		// addressed at this vnode get decapped via the vnode's sm2 (see
		// Driver dispatch path).
		if (command instanceof Security2CCNonceGet) {
			if (this.sm2 == null) return undefined;
			// Phase 4d: reply with a fresh receiverEI BUT preserve any
			// existing spanTable[peer] state (typically RemoteEI from a
			// just-arrived NonceReport in response to our own outbound
			// NonceGet). If we called sm2.generateNonce(sourceNodeId) here,
			// it would overwrite RemoteEI back to LocalEI and break the
			// outbound encryption serialize path. We trade away the ability
			// to decrypt encrypted frames FROM this peer to us (paddle→vnode),
			// which is fine for the LED-feedback use case where the only
			// secure traffic is vnode→paddle MultilevelSwitch.Set broadcasts.
			const sm2Any = this.sm2 as any;
			const preExisting = sm2Any.spanTable?.get(sourceNodeId);
			const nonce = await sm2Any.generateNonce(sourceNodeId);
			// Restore the prior state if we just clobbered RemoteEI/SPAN.
			// SPANState enum (Manager2Types.ts): None=0, RemoteEI=1,
			// LocalEI=2, SPAN=3.
			if (
				preExisting != null
				&& (preExisting.type === 1 /* RemoteEI */
					|| preExisting.type === 3 /* SPAN */)
			) {
				sm2Any.spanTable.set(sourceNodeId, preExisting);
			}
			return new Security2CCNonceReport({
				...addr,
				SOS: true,
				MOS: false,
				receiverEI: nonce,
			});
		}

		// ─── Security2CCCommandsSupportedGet ─────────────────────────────
		// After the S2 SPAN is established, HA queries which CCs the node
		// supports under S2 encryption. We report the same set as our NIF
		// (excluding Security CCs themselves which are implicit). HA uses
		// this to mark CCs as `secure: true` in its cache and to subsequent
		// query them inside Security2CCMessageEncapsulation wrappers.
		if (command instanceof Security2CCCommandsSupportedGet) {
			return new Security2CCCommandsSupportedReport({
				...addr,
				supportedCCs: this.nif.supportedCCs.filter(
					(cc) =>
						cc !== CommandClasses.Security
						&& cc !== CommandClasses["Security 2"],
				) as CommandClasses[],
			});
		}

		// ─── SecurityCC (S0): intentionally NOT handled here. ────────────
		// App-layer-generated nonces don't sync with the radio's nonce
		// table, so any encrypted CC follow-up from the primary will fail
		// MAC verification at the radio and be silently dropped. Without a
		// nonce response, HA gives up on S0 fallback faster and may
		// continue with other interview stages. Better outcome than a
		// permanent nonce-loop with no progress.

		// ─── NoOperationCC ────────────────────────────────────────────────
		if (command instanceof NoOperationCC) {
			return undefined;
		}

		return undefined;
	}

	/**
	 * Shared Remove implementation for AssociationCC + MultiChannel variant.
	 * Per Z-Wave spec:
	 *  - if groupId is 0 (or undefined): apply to all groups
	 *  - if nodeIds + endpoints both empty: remove ALL members from the
	 *    targeted group(s)
	 *  - otherwise: remove only the listed node-only and endpoint-aware
	 *    members from the targeted group(s)
	 */
	private _removeAssociations(
		groupId: number | undefined,
		nodeIds: number[],
		_endpointAware: boolean,
		endpointPairs: VirtualHostedAssociationMember[] = [],
	): void {
		const targets = groupId && groupId > 0
			? [groupId]
			: Array.from(this.associations.keys());
		const removeAll =
			nodeIds.length === 0 && endpointPairs.length === 0;
		let changed = false;
		for (const gid of targets) {
			const existing = this.associations.get(gid);
			if (existing == null || existing.length === 0) continue;
			if (removeAll) {
				this.associations.delete(gid);
				changed = true;
				continue;
			}
			const next = existing.filter((m) => {
				if (m.endpoint == null) {
					return !nodeIds.includes(m.nodeId);
				}
				return !endpointPairs.some(
					(ep) =>
						ep.nodeId === m.nodeId
						&& ep.endpoint === m.endpoint,
				);
			});
			if (next.length !== existing.length) {
				if (next.length === 0) this.associations.delete(gid);
				else this.associations.set(gid, next);
				changed = true;
			}
		}
		if (changed) this.onPersistableChange?.(this.id);
	}

	/**
	 * Best-effort CC version response. We declare the minimum sane version
	 * for each supported CC and the spec-defined v0 for anything else.
	 */
	private _ccVersionForReport(cc: CommandClasses): number {
		switch (cc) {
			case CommandClasses.Basic:
				return 2;
			case CommandClasses["Multilevel Switch"]:
				return 4;
			case CommandClasses["Binary Switch"]:
				return 2;
			case CommandClasses.Association:
				return 3;
			case CommandClasses["Multi Channel Association"]:
				return 4;
			case CommandClasses["Association Group Information"]:
				return 3;
			case CommandClasses.Version:
				return 3;
			case CommandClasses["Z-Wave Plus Info"]:
				return 2;
			case CommandClasses["Manufacturer Specific"]:
				return 2;
			default:
				// 0 = "not supported" per spec.
				return 0;
		}
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
		// Forward-compat backfill: vnodes persisted before group 3 existed
		// don't have it on disk. Re-add the default BinarySwitch Set Group
		// for dimmer-profile vnodes so the virtual relay capability is
		// available immediately without manual cache migration.
		if (
			data.profile === "dimmer" &&
			!node.associationGroups.has(BINARY_SET_GROUP_ID)
		) {
			node.associationGroups.set(
				BINARY_SET_GROUP_ID,
				DEFAULT_BINARY_SET_GROUP,
			);
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
