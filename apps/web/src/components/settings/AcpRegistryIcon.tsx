import {
  resolveOfficialAcpRegistryIconUrl,
  officialAcpRegistryIconUrlForAgentId,
} from "@orbiwork/contracts";

import { cn } from "../../lib/utils";
import { ACPRegistryIcon } from "../Icons";

export { officialAcpRegistryIconUrlForAgentId, resolveOfficialAcpRegistryIconUrl };

/**
 * Registry agents share the generic ACP glyph. The agent's CDN icon is not loaded: hot-linking
 * cdn.agentclientprotocol.com would tell it the user's IP every time a provider list renders.
 */
export function AcpRegistryAgentIcon({
  className,
  fallbackClassName,
}: {
  readonly icon: string | null;
  readonly className?: string;
  readonly fallbackClassName?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-muted-foreground",
        className,
      )}
    >
      <ACPRegistryIcon className={cn("size-4", fallbackClassName)} data-slot="acp-icon-fallback" />
    </span>
  );
}
