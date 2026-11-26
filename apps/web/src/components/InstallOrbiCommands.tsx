import { T } from "gt-react";
import { cn } from "~/lib/utils";

import { CommandBlock } from "./CommandBlock";

const BUILD_FROM_SOURCE_URL = "https://github.com/ferax564/OrbiWork#build-from-source";

/** Setup steps for another computer: get `orbi`, then run `command`. */
export function InstallOrbiCommands({
  command,
  className,
}: {
  readonly command: string;
  readonly className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-xs text-muted-foreground">
        <T>
          If you do not have <code className="font-mono">orbi</code> yet,{" "}
          <a
            className="underline underline-offset-2 hover:text-foreground"
            href={BUILD_FROM_SOURCE_URL}
            target="_blank"
            rel="noreferrer noopener"
          >
            build it from source
          </a>{" "}
          first. Then run:
        </T>
      </p>
      <CommandBlock command={command} />
    </div>
  );
}
