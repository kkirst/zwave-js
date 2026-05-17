import { MessagePriority } from "@zwave-js/core";
import {
	FunctionType,
	Message,
	type MessageBaseOptions,
	type MessageEncodingContext,
	type MessageParsingContext,
	type MessageRaw,
	MessageType,
	messageTypes,
	priority,
} from "@zwave-js/serial";
import { Bytes } from "@zwave-js/shared";

/**
 * FUNC_ID_SERIAL_API_APPL_SLAVE_NODE_INFORMATION (0xA0).
 *
 * Installs the Node Information Frame the radio will advertise for a given
 * virtual slave slot. The bridge controller calls this once per virtual node
 * to register what device classes + supported CCs the slot should look like
 * to other Z-Wave devices.
 *
 * Wire layout (Request):
 *   [nodeId][listening][generic][specific][nifLength][nif...]
 *
 * Fire-and-forget: the radio ACKs the frame but does NOT return a Response.
 * Mirrors the existing FUNC_ID_SERIAL_API_APPL_NODE_INFORMATION (0x03) at
 * `serialapi/capability/SetApplicationNodeInformationRequest.ts` — the slave
 * variant is the same protocol shape for a different NodeID target.
 */
export interface VirtualNodeSetNodeInfoRequestOptions {
	nodeId: number;
	listening: boolean;
	genericDeviceClass: number;
	specificDeviceClass: number;
	supportedCCs: readonly number[];
}

@messageTypes(MessageType.Request, FunctionType.VirtualNodeSetNodeInfo)
@priority(MessagePriority.Controller)
export class VirtualNodeSetNodeInfoRequest extends Message {
	public constructor(
		options: VirtualNodeSetNodeInfoRequestOptions & MessageBaseOptions,
	) {
		super(options);
		this.nodeId = options.nodeId;
		this.listening = options.listening;
		this.genericDeviceClass = options.genericDeviceClass;
		this.specificDeviceClass = options.specificDeviceClass;
		this.supportedCCs = options.supportedCCs;
	}

	public static from(
		raw: MessageRaw,
		_ctx: MessageParsingContext,
	): VirtualNodeSetNodeInfoRequest {
		const nodeId = raw.payload[0];
		const listening = raw.payload[1] !== 0;
		const genericDeviceClass = raw.payload[2];
		const specificDeviceClass = raw.payload[3];
		const nifLength = raw.payload[4];
		const supportedCCs = Array.from(
			raw.payload.subarray(5, 5 + nifLength),
		);
		return new this({
			nodeId,
			listening,
			genericDeviceClass,
			specificDeviceClass,
			supportedCCs,
		});
	}

	public nodeId: number;
	public listening: boolean;
	public genericDeviceClass: number;
	public specificDeviceClass: number;
	public supportedCCs: readonly number[];

	public serialize(ctx: MessageEncodingContext): Promise<Bytes> {
		const nif = Bytes.from(this.supportedCCs);
		this.payload = Bytes.concat([
			Bytes.from([
				this.nodeId,
				this.listening ? 0xff : 0x00,
				this.genericDeviceClass,
				this.specificDeviceClass,
				nif.length,
			]),
			nif,
		]);
		return super.serialize(ctx);
	}
}

