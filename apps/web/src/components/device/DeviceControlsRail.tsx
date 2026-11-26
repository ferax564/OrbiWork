import type { DeviceHostSummary, DevicePlatform } from "@orbiwork/contracts";
import {
  Camera,
  ChevronLeft,
  Home,
  MoreHorizontal,
  PictureInPicture2,
  Power,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Type,
  X,
  MoonIcon,
  SunIcon,
} from "lucide-react";
import { T, useGT, useMessages, msg } from "gt-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
} from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import type { DeviceStreamHandle, DeviceViewControls } from "./DeviceStreamView";
import type { DeviceControls } from "./useDeviceControls";

export function DeviceControlsRail(props: {
  platform: DevicePlatform;
  hostKind: DeviceHostSummary["kind"] | undefined;
  handle: DeviceStreamHandle | null;
  view: DeviceViewControls;
  controls: DeviceControls;
  screenshotPending: boolean;
  onScreenshot: () => void;
  toolsOpen: boolean;
  onTools: () => void;
  onFloat: () => void;
  onClose: () => void;
  onPowerOff: () => void;
}) {
  const { view, handle, controls } = props;
  const popupSide = "left";
  const settings = controls.detail?.settings;
  const inputDisabled = !handle?.inputConnected;
  const runsHostCommands = props.hostKind === "local" || props.hostKind === "ssh";
  const nextAppearance = settings?.appearance === "dark" ? "light" : "dark";
  const gt = useGT();
  const m = useMessages();
  return (
    <aside
      aria-label={gt("Device controls")}
      data-layout="rail"
      className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-14 flex-col items-center gap-2 overflow-y-auto [justify-content:safe_center] py-3 pr-2 [scrollbar-width:none]"
    >
      <div className="pointer-events-auto flex shrink-0 flex-col items-center gap-1 overflow-y-auto rounded-full border border-border/50 bg-background/80 p-2 shadow-sm [scrollbar-width:none]">
        <RailButton
          tooltipSide={popupSide}
          label={gt("Home", { $context: "device home button" })}
          disabled={inputDisabled}
          onClick={() => handle?.pressButton("home")}
        >
          <Home />
        </RailButton>
        {props.platform === "android" ? (
          <>
            <RailButton
              tooltipSide={popupSide}
              label={gt("Back", { $context: "device back button" })}
              disabled={inputDisabled}
              onClick={() => handle?.pressButton("back")}
            >
              <ChevronLeft />
            </RailButton>
            <RailButton
              tooltipSide={popupSide}
              label={gt("Recents", { $context: "Android recent apps button" })}
              disabled={inputDisabled}
              onClick={() => handle?.pressButton("recents")}
            >
              <Square />
            </RailButton>
            {runsHostCommands ? (
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={gt("Rotate device")}
                      disabled={controls.disabled}
                    />
                  }
                >
                  <RotateCcw />
                </MenuTrigger>
                <MenuPopup side={popupSide}>
                  <MenuItem
                    onClick={() => void controls.act({ type: "setOrientation", value: "portrait" })}
                  >
                    <T>Portrait</T>
                  </MenuItem>
                  <MenuItem
                    onClick={() =>
                      void controls.act({ type: "setOrientation", value: "landscape_left" })
                    }
                  >
                    <T>Landscape</T>
                  </MenuItem>
                </MenuPopup>
              </Menu>
            ) : null}
          </>
        ) : props.hostKind === "simlock" ? null : (
          <RailButton
            tooltipSide={popupSide}
            label={gt("Rotate device")}
            disabled={inputDisabled}
            onClick={() => handle?.rotate()}
          >
            <RotateCcw />
          </RailButton>
        )}
        {runsHostCommands ? (
          <>
            <RailDivider />
            <RailButton
              tooltipSide={popupSide}
              label={
                nextAppearance === "light"
                  ? gt("Switch device to light mode")
                  : gt("Switch device to dark mode")
              }
              disabled={controls.disabled || !settings?.appearance}
              onClick={() => void controls.act({ type: "setAppearance", value: nextAppearance })}
            >
              {settings?.appearance === "dark" ? <SunIcon /> : <MoonIcon />}
            </RailButton>
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={gt("Device text size")}
                    title={gt("Device text size")}
                    disabled={controls.disabled || !settings?.textSize}
                  />
                }
              >
                <Type />
              </MenuTrigger>
              <MenuPopup side={popupSide} className="min-w-40">
                <MenuRadioGroup
                  value={settings?.textSize ?? ""}
                  onValueChange={(value) => {
                    if (
                      value === "small" ||
                      value === "default" ||
                      value === "large" ||
                      value === "extra-large"
                    )
                      void controls.act({ type: "setTextSize", value });
                  }}
                >
                  {(
                    [
                      ["small", msg("Small")],
                      ["default", msg("Default")],
                      ["large", msg("Large")],
                      ["extra-large", msg("Extra large")],
                    ] as const
                  ).map(([value, label]) => (
                    <MenuRadioItem key={value} value={value}>
                      <span className="flex items-center gap-2">
                        <span className="flex-1">{m(label)}</span>
                        <MenuRadioItemIndicator />
                      </span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuPopup>
            </Menu>
            <RailButton
              tooltipSide={popupSide}
              label={gt("Device tools")}
              pressed={props.toolsOpen}
              onClick={props.onTools}
            >
              <SlidersHorizontal />
            </RailButton>
          </>
        ) : null}
        {props.hostKind === "simlock" ? null : (
          <RailButton
            tooltipSide={popupSide}
            label={props.screenshotPending ? gt("Capturing screenshot") : gt("Save screenshot")}
            disabled={!view.streaming || props.screenshotPending}
            onClick={props.onScreenshot}
          >
            <Camera />
          </RailButton>
        )}
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={gt("More device actions")}
                title={gt("More device actions")}
              />
            }
          >
            <MoreHorizontal />
          </MenuTrigger>
          <MenuPopup side={popupSide} align="end">
            <MenuItem onClick={props.onFloat}>
              <PictureInPicture2 />
              <T>Float device over chat</T>
            </MenuItem>
            <MenuItem onClick={props.onClose}>
              <X />
              <T>Close device panel</T>
            </MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={props.onPowerOff}>
              <Power />
              {props.hostKind === "simlock"
                ? gt("Return device to the pool")
                : gt("Power off device")}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {view.foldingControls}
    </aside>
  );
}

function RailDivider() {
  return <div aria-hidden className="my-1 h-px w-5 shrink-0 bg-border/70" />;
}

function RailButton(props: {
  tooltipSide: "left" | "bottom";
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const button = (
    <Button
      size="icon-sm"
      variant={props.pressed ? "secondary" : "ghost"}
      aria-label={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipPopup side={props.tooltipSide}>{props.label}</TooltipPopup>
    </Tooltip>
  );
}
