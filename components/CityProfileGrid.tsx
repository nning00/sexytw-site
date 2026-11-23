import Link from "next/link";
import OptimizedMediaImage from "@/components/OptimizedMediaImage";
import { CITY_PAGE_SIZE, cityPageNumbers, cityPagePath } from "@/lib/city-pagination.mjs";

export type CityProfileCard = {
  id: string;
  slug: string;
  name: string;
  image: string;
  imageAlt: string;
};

export default function CityProfileGrid({ profiles, total, page, regionSlug, citySlug }: { profiles: CityProfileCard[]; total: number; page: number; regionSlug: string; citySlug: string }) {
  const pages = Math.max(1, Math.ceil(total / CITY_PAGE_SIZE));
  const numbers = cityPageNumbers(page, pages);
  const href = (number: number) => `${cityPagePath(regionSlug, citySlug, number)}#profiles`;

  return <div id="profiles" className="city-profile-directory">
    <p className="city-page-summary">共 {total} 位 · 第 {page} / {pages} 頁{total > 0 && ` · 顯示 ${(page - 1) * CITY_PAGE_SIZE + 1}–${Math.min(page * CITY_PAGE_SIZE, total)} 位`}</p>
    {profiles.length ? <div className="profile-grid">
      {profiles.map((profile, index) => <Link className="profile-card" href={`/profiles/${profile.slug}#from-city=${encodeURIComponent(regionSlug)}/${encodeURIComponent(citySlug)}`} key={profile.id} prefetch={false}>
        <div className="profile-photo">
          <OptimizedMediaImage
            src={profile.image}
            alt={profile.imageAlt}
            fill
            preload={index === 0}
            sizes="(max-width: 680px) 50vw, 33vw"
          />
        </div>
        <div className="profile-info">
          <h3>{profile.name}</h3>
          <span>點我查看資訊</span>
        </div>
      </Link>)}
    </div> : <p className="city-empty">此城市目前沒有公開形象，請稍後再來，或選擇其他城市。</p>}
    {pages > 1 && <nav className="city-pagination" aria-label="城市形象分頁">
      <div className="city-pagination-direction">
        {page > 1 ? <Link href={href(page - 1)} prefetch={false} rel="prev">上一頁</Link> : <span aria-disabled="true">上一頁</span>}
        <span className="city-pagination-position">{page} / {pages}</span>
        {page < pages ? <Link href={href(page + 1)} prefetch={false} rel="next">下一頁</Link> : <span aria-disabled="true">下一頁</span>}
      </div>
      <div className="city-pagination-numbers">
        {numbers.map((number, index) => <span className="city-pagination-slot" key={number}>
          {index > 0 && number - numbers[index - 1] > 1 && <span className="city-pagination-gap" aria-hidden="true">…</span>}
          <Link href={href(number)} prefetch={false} aria-label={`第 ${number} 頁${number === pages ? '（最後一頁）' : ''}`} aria-current={number === page ? "page" : undefined}>{number === pages && pages > 3 ? `末頁 ${number}` : number}</Link>
        </span>)}
      </div>
    </nav>}
  </div>;
}
