import type { SellerData } from '../types/domain'
import { ChannelBadge, DataTable, PageHeader, StatusBadge } from '../components/ui'

export function Settings({ data, section, mode = 'mock' }: { data: SellerData; section: string; mode?: 'mock' | 'supabase' | 'local' }) {
  if (section === 'channels') return <>
    <PageHeader title="판매채널 현황" description="등록된 판매채널과 상품 현황을 확인합니다." />
    <div className="notice">채널 상품 정보는 가져온 자료를 기준으로 표시됩니다. 실시간으로 자동 연동되지는 않습니다.</div>
    <section className="panel"><DataTable><thead><tr><th>판매채널</th><th>채널 코드</th><th>상품페이지</th><th>판매 옵션</th><th>사용 상태</th></tr></thead><tbody>{data.channels.map(channel => {
      const listings = data.listings.filter(listing => listing.channelId === channel.id)
      return <tr key={channel.id}><td><ChannelBadge channel={channel} /></td><td className="mono">{channel.channelCode}</td><td>{listings.length}개</td><td>{data.offers.filter(offer => listings.some(listing => listing.id === offer.listingId)).length}개</td><td><StatusBadge status={channel.status} label={channel.status === 'ACTIVE' ? '사용중' : '사용안함'} /></td></tr>
    })}</tbody></DataTable></section>
  </>
  const storage = mode === 'local' ? '서버 PC의 로컬 데이터베이스' : mode === 'supabase' ? '연결된 데이터베이스' : '이 브라우저의 데모 데이터'
  return <>
    <PageHeader title="워크스페이스" description="현재 작업 공간과 데이터 현황을 확인합니다." />
    <section className="panel workspace-panel"><div className="workspace-cover"><span className="workspace-avatar">S</span><div><h2>{data.workspace.name}</h2></div></div>
      <dl className="info-grid"><div><dt>데이터 저장 위치</dt><dd>{storage}</dd></div><div><dt>판매상품</dt><dd>{data.products.length.toLocaleString()}개</dd></div><div><dt>저장된 매핑 별칭</dt><dd>{data.aliases.length.toLocaleString()}개</dd></div><div><dt>판매채널</dt><dd>{data.channels.length.toLocaleString()}개</dd></div></dl>
      {mode === 'mock' && <div className="notice">데모 데이터는 이 브라우저에 저장되며 다른 기기와 공유되지 않습니다.</div>}
    </section>
  </>
}
