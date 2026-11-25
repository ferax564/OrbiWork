import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

export function OrbiWordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  const aspectRatio = 115 / 40;
  return (
    <Svg
      accessibilityLabel="Orbi"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="0 0 115 40"
    >
      <ThemedPath
        d="M0 20a20 20 0 1 1 40 0a20 20 0 1 1-40 0ZM7.5 20a12.5 12.5 0 1 0 25 0a12.5 12.5 0 1 0-25 0ZM46 12h7v4.5a11 11 0 0 1 11-4.5v7a11 11 0 0 0-11 9V40h-7ZM70 0h7v40h-7ZM74 26a14 14 0 1 1 28 0a14 14 0 1 1-28 0ZM81 26a7 7 0 1 0 14 0a7 7 0 1 0-14 0ZM108 12h7v28h-7ZM107 4.5a4.5 4.5 0 1 1 9 0a4.5 4.5 0 1 1-9 0Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
