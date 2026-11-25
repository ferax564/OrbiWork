import { createIssueTrackerEnvironmentAtoms } from "@orbiwork/client-runtime/state/issue-trackers";

import { connectionAtomRuntime } from "../connection/runtime";

export const issueTrackerEnvironment = createIssueTrackerEnvironmentAtoms(connectionAtomRuntime);
