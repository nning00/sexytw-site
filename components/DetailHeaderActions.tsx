import Link from "next/link";
import type { ReactNode } from "react";

type DetailHeaderActionsProps = {
  backHref: string;
  backLabel: string;
  lineUrl: string;
  lineLabel: string;
  backLink?: ReactNode;
};

export default function DetailHeaderActions({ backHref, backLabel, lineUrl, lineLabel, backLink }: DetailHeaderActionsProps) {
  return (
    <div className="detail-header-actions">
      {backLink ?? <Link className="detail-back-link" href={backHref}>{backLabel}</Link>}
      <a className="nav-cta detail-line-cta" href={lineUrl} target="_blank" rel="noopener noreferrer">{lineLabel}</a>
    </div>
  );
}

