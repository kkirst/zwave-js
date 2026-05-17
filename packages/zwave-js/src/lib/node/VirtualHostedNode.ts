import { type CommandClass } from "@zwave-js/cc";
import { getCCName } from "@zwave-js/core";

/**
 * Represents a Z-Wave end node that the host (Bridge Controller) hosts
 * virtually — i.e., other physical Z-Wave devices on the network may
 * associate with it as a command target. Frames addressed at this NodeID
 * arrive on the host via the Bridge Controller's FUNC_ID_APPLICATION_*
 * inbound serial-API path, are parsed as a `BridgeApplicationCommandRequest`,
 * and dispatched here by `Driver.handleRequest`.
 *
 * Distinct from the existing `VirtualNode` (outbound multicast abstraction)
 * — the naming collision is unfortunate but the two classes serve opposite
 * directions of the bridge feature.
 *
 * This file is the minimal Phase-2 scaffold sufficient to validate the
 * driver dispatch wiring (Checkpoint 2): the class records every command
 * it receives so tests can assert. Phase 3 fleshes this out with NIF,
 * security keys, association tables, and a proper value DB.
 */
export class VirtualHostedNode {
	public readonly id: number;

	/**
	 * Test hook: every command dispatched to this virtual node is appended
	 * here so the integration test can assert "the dispatch reached us".
	 * Phase 3 will replace this with a real value DB + event-based reporting.
	 */
	public readonly receivedCommands: Array<{
		sourceNodeId: number;
		commandClassName: string;
		commandClass: number;
	}> = [];

	public constructor(id: number) {
		this.id = id;
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
}
