// The production icon, as GitHub shows the OrbiWork app, whatever this build's channel.
import appIconUrl from "../../../../assets/prod/orbi-black-web-apple-touch-180.png";

export function OrbiAppIcon(props: { readonly className?: string }) {
  return <img src={appIconUrl} alt="" className={props.className} />;
}
