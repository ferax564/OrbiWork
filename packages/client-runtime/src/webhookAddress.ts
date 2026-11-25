import type { ScheduledTaskWebhookEndpoint } from "@orbiwork/contracts";
import { isLocalLoopbackHost } from "@orbiwork/shared/hostClassification";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

export interface WebhookAddress {
  readonly address: string;
  readonly copyable: boolean;
  readonly note: string | null;
}

export function webhookAddress(
  endpoint: ScheduledTaskWebhookEndpoint,
  httpBaseUrl: string | null,
  resolve: MFunctionType = mFallback,
): WebhookAddress {
  if (httpBaseUrl === null) {
    return {
      address: endpoint.path,
      copyable: false,
      note: resolve(
        msg("Pair this environment at a network address, such as over Tailscale, for a URL."),
      ),
    };
  }
  const url = new URL(endpoint.path, httpBaseUrl);
  return {
    address: url.href,
    copyable: true,
    note: isLocalLoopbackHost(url.hostname)
      ? resolve(
          msg(
            "Only this computer can call this address. Use Tailscale or your own proxy to reach it from elsewhere.",
          ),
        )
      : resolve(
          msg(
            "Works wherever this environment's address is reachable, for example over Tailscale or your own proxy.",
          ),
        ),
  };
}
