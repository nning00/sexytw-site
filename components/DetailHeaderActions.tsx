import Link from "next/link";

type DetailHeaderActionsProps = {
  backHref: string;
  backLabel: string;
  lineUrl: string;
  lineLabel: string;
};

export default function DetailHeaderActions({ backHref, backLabel, lineUrl, lineLabel }: DetailHeaderActionsProps) {
  return (
    <div className="detail-header-actions">
      <Link className="detail-back-link" href={backHref}>{backLabel}</Link>
      <a className="nav-cta detail-line-cta" href={lineUrl} target="_blank" rel="noopener noreferrer">{lineLabel}</a>
    </div>
  );
}

