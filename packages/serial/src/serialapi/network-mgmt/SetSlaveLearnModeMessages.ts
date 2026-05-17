import {
	type MessageOrCCLogEntry,
	MessagePriority,
	type MessageRecord,
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
 * Operating modes for the radio's virtual-node learn-mode controller.
 * Mirrors the Silicon Labs FUNC_ID_ZW_SET_SLAVE_LEARN_MODE wire definition
 * (0xA4). The host enables the desired mode, gets a synchronous Response
 * (success boolean), then receives one or more async Callbacks reporting
 * progress (Started → Done / Failed).
 */
export enum SlaveLearnMode {
	/** Disable virtual-node learn mode; cancel any pending inclusion/exclusion. */
	Disable = 0x00,
	/** Wait passively for the primary controller's "set node ID" frame. */
	Enable = 0x01,
	/** Initiate add-virtual-node toward the primary controller. */
	Add = 0x02,
	/** Initiate remove-virtual-node toward the primary controller. */
	Remove = 0x03,
}

export enum SlaveLearnModeStatus {
	Started = 0x01,
	Done = 0x06,
	Failed = 0x07,
}

@messageTypes(MessageType.Request, FunctionType.VirtualNodeSetLearnMode)
@priority(MessagePriority.Controller)
export class SetSlaveLearnModeRequestBase extends Message {
	public static from(
		raw: MessageRaw,
		ctx: MessageParsingContext,
	): SetSlaveLearnModeRequestBase {
		// Same Request function type covers both the host-originated Request
		// and the radio-originated async Callback. Direction comes from the
		// MessageParsingContext.origin.
		if (ctx.origin === MessageOrigin.Host) {
			return SetSlaveLearnModeRequest.from(raw, ctx);
		} else {
			return SetSlaveLearnModeCallback.from(raw, ctx);
		}
	}
}

export interface SetSlaveLearnModeRequestOptions {
	nodeId: number;
	mode: SlaveLearnMode;
}

@expectedResponse(FunctionType.VirtualNodeSetLearnMode)
export class SetSlaveLearnModeRequest extends SetSlaveLearnModeRequestBase {
	public constructor(
		options: SetSlaveLearnModeRequestOptions & MessageBaseOptions,
	) {
		super(options);
		this.nodeId = options.nodeId;
		this.mode = options.mode;
	}

	public static from(
		_raw: MessageRaw,
		_ctx: MessageParsingContext,
	): SetSlaveLearnModeRequest {
		throw new ZWaveError(
			`${this.name}: deserialization not implemented`,
			ZWaveErrorCodes.Deserialization_NotImplemented,
		);
	}

	public nodeId: number;
	public mode: SlaveLearnMode;

	public serialize(ctx: MessageEncodingContext): Promise<Bytes> {
		this.assertCallbackId();
		// Wire layout: [nodeId, mode, callbackId]
		// nodeId == 0 with mode == Add tells the radio to allocate a fresh
		// virtual node ID. For Remove, nodeId is the target virtual node.
		this.payload = Bytes.from([
			this.nodeId,
			this.mode,
			this.callbackId,
		]);
		return super.serialize(ctx);
	}

	public toLogEntry(): MessageOrCCLogEntry {
		return {
			...super.toLogEntry(),
			message: {
				"callback id": this.callbackId ?? "(not set)",
				"node id": this.nodeId,
				mode: getEnumMemberName(SlaveLearnMode, this.mode),
			},
		};
	}
}

export interface SetSlaveLearnModeResponseOptions {
	success: boolean;
}

@messageTypes(MessageType.Response, FunctionType.VirtualNodeSetLearnMode)
export class SetSlaveLearnModeResponse extends Message
	implements SuccessIndicator
{
	public constructor(
		options: SetSlaveLearnModeResponseOptions & MessageBaseOptions,
	) {
		super(options);
		this.success = options.success;
	}

	public static from(
		raw: MessageRaw,
		_ctx: MessageParsingContext,
	): SetSlaveLearnModeResponse {
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

export interface SetSlaveLearnModeCallbackOptions {
	status: SlaveLearnModeStatus;
	originalNodeId: number;
	newNodeId: number;
}

export class SetSlaveLearnModeCallback extends SetSlaveLearnModeRequestBase
	implements SuccessIndicator
{
	public constructor(
		options: SetSlaveLearnModeCallbackOptions & MessageBaseOptions,
	) {
		super(options);
		this.callbackId = options.callbackId;
		this.status = options.status;
		this.originalNodeId = options.originalNodeId;
		this.newNodeId = options.newNodeId;
	}

	public static from(
		raw: MessageRaw,
		_ctx: MessageParsingContext,
	): SetSlaveLearnModeCallback {
		// Wire layout: [callbackId, status, originalNodeId, newNodeId]
		// originalNodeId == 0 for Add operations; newNodeId is the assigned
		// virtual NodeID once status == Done.
		const callbackId = raw.payload[0];
		const status: SlaveLearnModeStatus = raw.payload[1];
		const originalNodeId = raw.payload[2];
		const newNodeId = raw.payload[3];
		return new this({
			callbackId,
			status,
			originalNodeId,
			newNodeId,
		});
	}

	public readonly status: SlaveLearnModeStatus;
	public readonly originalNodeId: number;
	public readonly newNodeId: number;

	isOK(): boolean {
		return this.status !== SlaveLearnModeStatus.Failed;
	}

	public toLogEntry(): MessageOrCCLogEntry {
		const message: MessageRecord = {
			"callback id": this.callbackId ?? "(not set)",
			status: getEnumMemberName(SlaveLearnModeStatus, this.status),
		};
		if (this.originalNodeId) {
			message["original node id"] = this.originalNodeId;
		}
		if (this.newNodeId) {
			message["new node id"] = this.newNodeId;
		}
		return {
			...super.toLogEntry(),
			message,
		};
	}
}
