import { BasicCCSet } from "@zwave-js/cc/BasicCC";
import { BridgeApplicationCommandRequest } from "@zwave-js/serial";
import { integrationTest } from "../integrationTestSuite.js";
import { VirtualHostedNode } from "../../node/VirtualHostedNode.js";

// Phase 2 / Checkpoint 2:
//   A dummy virtual node manually inserted into `driver.virtualNodes`
//   correctly receives a synthetic BridgeApplicationCommandRequest whose
//   `targetNodeId` matches the virtual node's ID.
//
//   This isolates the dispatch wiring — no inclusion, no security, no CC
//   handler — just "did the frame reach the virtual node's handler".
integrationTest(
	"BridgeApplicationCommandRequest addressed to a hosted virtual node dispatches to it",
	{
		// debug: true,

		additionalDriverOptions: {
			testingHooks: {
				skipFirmwareIdentification: true,
				skipNodeInterview: true,
			},
		},

		async testBody(t, driver, node, mockController, mockNode) {
			// Pick a NodeID well outside the range any mock physical node
			// might use, to make the dispatch decision unambiguous.
			const virtualNodeId = 250;
			const virtualNode = new VirtualHostedNode(virtualNodeId);
			driver.virtualNodes.set(virtualNodeId, virtualNode);

			// Construct an inbound bridge frame:
			//   source = mockNode (a real physical node in this test mesh)
			//   destination = our virtual node ID
			//   payload    = BasicCCSet(targetValue=42)
			// NB: BridgeApplicationCommandRequest.getNodeId() returns
			// `command.nodeId` for singlecast commands, so the CC's nodeId
			// must be the SOURCE (mockNode.id), not the destination. The
			// destination flows through the outer `targetNodeId` field.
			const cc = new BasicCCSet({
				nodeId: mockNode.id, // source — see getNodeId() override
				targetValue: 42,
			});
			const bridgeFrame = new BridgeApplicationCommandRequest({
				command: cc,
				frameType: "singlecast",
				ownNodeId: mockController.ownNodeId,
				fromForeignHomeId: false,
				isExploreFrame: false,
				isForeignFrame: false,
				routedBusy: false,
				nodeId: mockNode.id, // source physical node
				targetNodeId: virtualNodeId, // destination = our virtual node
			});

			mockController.sendMessageToHost(bridgeFrame, mockNode);

			// The dispatch should land in virtualNode.handleCommand within a
			// small number of event loop ticks. Poll briefly rather than
			// hard-sleep so the test stays snappy.
			await new Promise<void>((resolve, reject) => {
				const start = Date.now();
				const check = () => {
					if (virtualNode.receivedCommands.length > 0) return resolve();
					if (Date.now() - start > 5_000) {
						return reject(
							new Error(
								"timeout: virtual node never received the dispatched command",
							),
						);
					}
					setTimeout(check, 20);
				};
				check();
			});

			t.expect(virtualNode.receivedCommands.length).toBe(1);
			t.expect(virtualNode.receivedCommands[0].sourceNodeId).toBe(
				mockNode.id,
			);
			t.expect(virtualNode.receivedCommands[0].commandClassName).toBe(
				"Basic",
			);

			// Negative check: the mockNode (the source) should NOT have been
			// treated as the dispatch target. If it had, BasicCCValues.currentValue
			// would have been written on the real ZWaveNode (per
			// handleUnsolicited.test.ts behavior).
			const realNodeValue = node.getValue({
				commandClass: cc.ccId,
				property: "currentValue",
			});
			t.expect(realNodeValue).toBeUndefined();
		},
	},
);
