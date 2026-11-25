import {
  type ConnectMcpApprovalCall,
  createConnectMcpApprovalCommand,
} from "@orbiwork/client-runtime/state/connectMcpApproval";
import { runAtomCommand, squashAtomCommandFailure } from "@orbiwork/client-runtime/state/runtime";
import type { EnvironmentId } from "@orbiwork/contracts";
import * as Result from "effect/Result";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";

const connectMcpApproval = createConnectMcpApprovalCommand(connectionAtomRuntime);

/** One agent sign-in call to `environmentId`, sent with this account's Orbi Connect session. */
export async function runConnectMcpApproval(
  environmentId: EnvironmentId,
  call: ConnectMcpApprovalCall,
) {
  const result = await runAtomCommand(
    appAtomRegistry,
    connectMcpApproval,
    { environmentId, call },
    { reportFailure: false },
  );
  return result._tag === "Success"
    ? Result.succeed(result.value)
    : Result.fail(squashAtomCommandFailure(result));
}
