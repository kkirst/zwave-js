import {
	MAX_NODES,
	MessagePriority,
	NUM_NODEMASK_BYTES,
	encodeBitMask,
	parseNodeBitMask,
} from "@zwave-js/core";
import {
	FunctionType,
	Message,
	type MessageBaseOptions,
	type MessageEncodingContext,
	type MessageParsingContext,
	type MessageRaw,
	MessageType,
	expectedResponse,
	messageTypes,
	priority,
} from "@zwave-js/serial";
import { Bytes } from "@zwave-js/shared";

@messageTypes(MessageType.Request, FunctionType.GetVirtualNodes)
@expectedResponse(FunctionType.GetVirtualNodes)
@priority(MessagePriority.Controller)
export class GetVirtualNodesRequest extends Message {}

export interface GetVirtualNodesResponseOptions {
	virtualNodeIds: readonly number[];
}

@messageTypes(MessageType.Response, FunctionType.GetVirtualNodes)
export class GetVirtualNodesResponse extends Message {
	public constructor(
		options: GetVirtualNodesResponseOptions & MessageBaseOptions,
	) {
		super(options);
		this.virtualNodeIds = options.virtualNodeIds;
	}

	public static from(
		raw: MessageRaw,
		_ctx: MessageParsingContext,
	): GetVirtualNodesResponse {
		// Payload is a fixed-size 29-byte node bitmask (NUM_NODEMASK_BYTES).
		// Bit position N-1 set ⇒ NodeID N is a virtual node hosted by the
		// Bridge Controller. No length prefix; the radio firmware always
		// returns exactly NUM_NODEMASK_BYTES bytes.
		const bitmask = raw.payload.subarray(0, NUM_NODEMASK_BYTES);
		const virtualNodeIds = parseNodeBitMask(bitmask);
		return new this({ virtualNodeIds });
	}

	public readonly virtualNodeIds: readonly number[];

	public serialize(ctx: MessageEncodingContext): Promise<Bytes> {
		this.payload = Bytes.from(encodeBitMask(this.virtualNodeIds, MAX_NODES));
		return super.serialize(ctx);
	}
}
