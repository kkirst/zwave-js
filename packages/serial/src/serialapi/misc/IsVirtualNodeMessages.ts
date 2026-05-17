import { MessagePriority } from "@zwave-js/core";
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

export interface IsVirtualNodeRequestOptions {
	nodeId: number;
}

@messageTypes(MessageType.Request, FunctionType.IsVirtualNode)
@expectedResponse(FunctionType.IsVirtualNode)
@priority(MessagePriority.Controller)
export class IsVirtualNodeRequest extends Message {
	public constructor(
		options: IsVirtualNodeRequestOptions & MessageBaseOptions,
	) {
		super(options);
		this.nodeId = options.nodeId;
	}

	public static from(
		raw: MessageRaw,
		_ctx: MessageParsingContext,
	): IsVirtualNodeRequest {
		return new this({ nodeId: raw.payload[0] });
	}

	public nodeId: number;

	public serialize(ctx: MessageEncodingContext): Promise<Bytes> {
		this.payload = Bytes.from([this.nodeId]);
		return super.serialize(ctx);
	}
}

export interface IsVirtualNodeResponseOptions {
	isVirtual: boolean;
}

@messageTypes(MessageType.Response, FunctionType.IsVirtualNode)
export class IsVirtualNodeResponse extends Message {
	public constructor(
		options: IsVirtualNodeResponseOptions & MessageBaseOptions,
	) {
		super(options);
		this.isVirtual = options.isVirtual;
	}

	public static from(
		raw: MessageRaw,
		_ctx: MessageParsingContext,
	): IsVirtualNodeResponse {
		// Single byte: non-zero ⇒ the queried NodeID is a virtual node.
		const isVirtual = raw.payload[0] !== 0;
		return new this({ isVirtual });
	}

	public readonly isVirtual: boolean;

	public serialize(ctx: MessageEncodingContext): Promise<Bytes> {
		this.payload = Bytes.from([this.isVirtual ? 1 : 0]);
		return super.serialize(ctx);
	}
}
