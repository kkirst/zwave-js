import {
	type MessageOrCCLogEntry,
	MessagePriority,
	type MessageRecord,
	type TransmitStatus,
	ZWaveError,
	ZWaveErrorCodes,
} from "@zwave-js/core";
import {
	FunctionType,
	Message,
	type MessageBaseOptions,
	type MessageEncodingContext,
	MessageOrigin,
	type MessageParsingContext,
	type MessageRaw,
	MessageType,
	type SuccessIndicator,
	expectedResponse,
	messageTypes,
	priority,
} from "@zwave-js/serial";
import { Bytes, getEnumMemberName } from "@zwave-js/shared";

/**
 * FUNC_ID_ZW_SEND_SLAVE_NODE_INFORMATION (0xA2).
 *
 * Transmits a virtual slave's Node Information Frame on the wire, from the
 * virtual slave's NodeID to a target controller. Used after virtual-slave
 * allocation (SetSlaveLearnMode ADD success) to announce the new slave's
 * capabilities to other controllers on the mesh — without this step, other
 * Primary controllers do NOT learn about the new node automatically. Per
 * OpenZWave Driver.cpp:6068-6093 reference flow, this is the standard
 * follow-up to AssignNodeIdDone.
 *
 * Wire layout (Request):
 *   [srcNodeId, destNodeId, txOpts, callbackId]
 * Synchronous Response: [success] (single byte, 0 = rejected, !=0 = ok).
 * Asynchronous Callback: [callbackId, txStatus].
 */
export interface VirtualNodeSendNodeInfoRequestOptions {
	srcNodeId: number;
	destNodeId: number;
	txOptions?: number;
}

@messageTypes(MessageType.Request, FunctionType.VirtualNodeSendNodeInfo)
@priority(MessagePriority.Controller)
export class VirtualNodeSendNodeInfoRequestBase extends Message {
	public static from(
		raw: MessageRaw,
		ctx: MessageParsingContext,
	): VirtualNodeSendNodeInfoRequestBase {
		if (ctx.origin === MessageOrigin.Host) {
			return VirtualNodeSendNodeInfoRequest.from(raw, ctx);
		} else {
			return VirtualNodeSendNodeInfoCallback.from(raw, ctx);
		}
	}
}

@expectedResponse(FunctionType.VirtualNodeSendNodeInfo)
export class VirtualNodeSendNodeInfoRequest
	extends VirtualNodeSendNodeInfoRequestBase
{
	public constructor(
		options: VirtualNodeSendNodeInfoRequestOptions & MessageBaseOptions,
	) {
		super(options);
		this.srcNodeId = options.srcNodeId;
		this.destNodeId = options.destNodeId;
		// Default txOptions = TRANSMIT_OPTION_ACK | TRANSMIT_OPTION_AUTO_ROUTE
		// (0x01 | 0x04 = 0x05). Standard for application frames.
		this.txOptions = options.txOptions ?? 0x05;
	}

	public static from(
		_raw: MessageRaw,
		_ctx: MessageParsingContext,
	): VirtualNodeSendNodeInfoRequest {
		throw new ZWaveError(
			`${this.name}: deserialization not implemented`,
			ZWaveErrorCodes.Deserialization_NotImplemented,
		);
	}

	public srcNodeId: number;
	public destNodeId: number;
	public txOptions: number;

	public serialize(ctx: MessageEncodingContext): Promise<Bytes> {
		this.assertCallbackId();
		this.payload = Bytes.from([
			this.srcNodeId,
			this.destNodeId,
			this.txOptions,
			this.callbackId,
		]);
		return super.serialize(ctx);
	}

	public toLogEntry(): MessageOrCCLogEntry {
		return {
			...super.toLogEntry(),
			message: {
				"callback id": this.callbackId ?? "(not set)",
				"src node id": this.srcNodeId,
				"dest node id": this.destNodeId,
				"tx options": `0x${this.txOptions.toString(16)}`,
			},
		};
	}
}

export interface VirtualNodeSendNodeInfoResponseOptions {
	success: boolean;
}

@messageTypes(MessageType.Response, FunctionType.VirtualNodeSendNodeInfo)
export class VirtualNodeSendNodeInfoResponse extends Message
	implements SuccessIndicator
{
	public constructor(
		options: VirtualNodeSendNodeInfoResponseOptions & MessageBaseOptions,
	) {
		super(options);
		this.success = options.success;
	}

	public static from(
		raw: MessageRaw,
		_ctx: MessageParsingContext,
	): VirtualNodeSendNodeInfoResponse {
		const success = raw.payload[0] !== 0;
		return new this({ success });
	}

	public readonly success: boolean;

	isOK(): boolean {
		return this.success;
	}

	public toLogEntry(): MessageOrCCLogEntry {
		return {
			...super.toLogEntry(),
			message: { success: this.success },
		};
	}
}

export interface VirtualNodeSendNodeInfoCallbackOptions {
	txStatus: TransmitStatus;
}

export class VirtualNodeSendNodeInfoCallback
	extends VirtualNodeSendNodeInfoRequestBase
	implements SuccessIndicator
{
	public constructor(
		options: VirtualNodeSendNodeInfoCallbackOptions & MessageBaseOptions,
	) {
		super(options);
		this.callbackId = options.callbackId;
		this.txStatus = options.txStatus;
	}

	public static from(
		raw: MessageRaw,
		_ctx: MessageParsingContext,
	): VirtualNodeSendNodeInfoCallback {
		// Wire layout: [callbackId, txStatus]
		const callbackId = raw.payload[0];
		const txStatus: TransmitStatus = raw.payload[1];
		return new this({ callbackId, txStatus });
	}

	public readonly txStatus: TransmitStatus;

	isOK(): boolean {
		// TransmitStatus.OK = 0
		return this.txStatus === 0;
	}

	public toLogEntry(): MessageOrCCLogEntry {
		const message: MessageRecord = {
			"callback id": this.callbackId ?? "(not set)",
			"tx status": `0x${this.txStatus.toString(16)}`,
		};
		return {
			...super.toLogEntry(),
			message,
		};
	}
}
