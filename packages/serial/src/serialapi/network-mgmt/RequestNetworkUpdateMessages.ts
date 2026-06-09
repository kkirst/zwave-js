import {
	type MessageOrCCLogEntry,
	MessagePriority,
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
	expectedCallback,
	expectedResponse,
	messageTypes,
	priority,
} from "@zwave-js/serial";
import { Bytes, getEnumMemberName } from "@zwave-js/shared";

/** Status of an automatic controller (SUC/SIS) network update */
export enum NetworkUpdateStatus {
	/** The update was completed successfully */
	Done = 0x00,
	/** The update was aborted by the SUC/SIS */
	Aborted = 0x01,
	/** Another update is already in progress — try again later */
	Wait = 0x02,
	/** No SUC/SIS is configured, or it has automatic updates disabled */
	Disabled = 0x03,
	/** The SUC/SIS had more pending updates than fit in a single transfer */
	Overflow = 0x04,
}

@messageTypes(MessageType.Request, FunctionType.RequestNetworkUpdate)
@priority(MessagePriority.Controller)
export class RequestNetworkUpdateRequestBase extends Message {
	public static from(
		raw: MessageRaw,
		ctx: MessageParsingContext,
	): RequestNetworkUpdateRequestBase {
		if (ctx.origin === MessageOrigin.Host) {
			return RequestNetworkUpdateRequest.from(raw, ctx);
		} else {
			return RequestNetworkUpdateCallback.from(raw, ctx);
		}
	}
}

@expectedResponse(FunctionType.RequestNetworkUpdate)
@expectedCallback(FunctionType.RequestNetworkUpdate)
export class RequestNetworkUpdateRequest
	extends RequestNetworkUpdateRequestBase
{
	public constructor(options: MessageBaseOptions = {}) {
		super(options);
	}

	public static from(
		raw: MessageRaw,
		_ctx: MessageParsingContext,
	): RequestNetworkUpdateRequest {
		const callbackId = raw.payload[0];
		return new this({ callbackId });
	}

	public serialize(ctx: MessageEncodingContext): Promise<Bytes> {
		this.assertCallbackId();
		this.payload = Bytes.from([this.callbackId!]);
		return super.serialize(ctx);
	}

	public getCallbackTimeout(): number | undefined {
		// Replicating the full network delta from the SUC/SIS can take a while,
		// especially with many nodes. Allow generously before giving up.
		return 60000;
	}

	public toLogEntry(): MessageOrCCLogEntry {
		return {
			...super.toLogEntry(),
			message: {
				"callback id": this.callbackId ?? "(not set)",
			},
		};
	}
}

export interface RequestNetworkUpdateResponseOptions {
	wasExecuted: boolean;
}

@messageTypes(MessageType.Response, FunctionType.RequestNetworkUpdate)
export class RequestNetworkUpdateResponse extends Message
	implements SuccessIndicator
{
	public constructor(
		options: RequestNetworkUpdateResponseOptions & MessageBaseOptions,
	) {
		super(options);
		this.wasExecuted = options.wasExecuted;
	}

	public static from(
		raw: MessageRaw,
		_ctx: MessageParsingContext,
	): RequestNetworkUpdateResponse {
		const wasExecuted = raw.payload[0] !== 0;
		return new this({ wasExecuted });
	}

	public isOK(): boolean {
		return this.wasExecuted;
	}

	public wasExecuted: boolean;

	public serialize(ctx: MessageEncodingContext): Promise<Bytes> {
		this.payload = Bytes.from([this.wasExecuted ? 0x01 : 0]);
		return super.serialize(ctx);
	}

	public toLogEntry(): MessageOrCCLogEntry {
		return {
			...super.toLogEntry(),
			message: { "was executed": this.wasExecuted },
		};
	}
}

export interface RequestNetworkUpdateCallbackOptions {
	updateStatus: NetworkUpdateStatus;
}

export class RequestNetworkUpdateCallback
	extends RequestNetworkUpdateRequestBase
	implements SuccessIndicator
{
	public constructor(
		options: RequestNetworkUpdateCallbackOptions & MessageBaseOptions,
	) {
		super(options);
		this.callbackId = options.callbackId;
		this.updateStatus = options.updateStatus;
	}

	public static from(
		raw: MessageRaw,
		_ctx: MessageParsingContext,
	): RequestNetworkUpdateCallback {
		const callbackId = raw.payload[0];
		const updateStatus: NetworkUpdateStatus = raw.payload[1];
		return new this({ callbackId, updateStatus });
	}

	public isOK(): boolean {
		return this.updateStatus === NetworkUpdateStatus.Done;
	}

	public updateStatus: NetworkUpdateStatus;

	public serialize(ctx: MessageEncodingContext): Promise<Bytes> {
		this.assertCallbackId();
		this.payload = Bytes.from([this.callbackId!, this.updateStatus]);
		return super.serialize(ctx);
	}

	public toLogEntry(): MessageOrCCLogEntry {
		return {
			...super.toLogEntry(),
			message: {
				"callback id": this.callbackId ?? "(not set)",
				"update status": getEnumMemberName(
					NetworkUpdateStatus,
					this.updateStatus,
				),
			},
		};
	}
}
