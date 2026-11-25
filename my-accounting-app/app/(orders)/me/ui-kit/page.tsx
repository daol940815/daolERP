'use client'
// UI 통일 기준 견본 화면 (UI 디자인 트랙 2단계, 2026-11-25) — 메뉴에는 없다. 주소 /me/ui-kit
// 공용 부품(components/ui/kit.tsx · cell-grid.tsx · modal.tsx)이 실제로 어떻게 보이는지 한 화면에 모았다.
// 부품을 고치면 여기서 먼저 확인한다. 데이터는 모두 예시(가짜).
import { useState } from 'react'
import { Page, PageHeader, SectionTitle, Card, FilterRow, Button, btnCls, Input, Select, Textarea, Field, Badge, Chip, KpiGrid, KpiCard, TableCard, tbl } from '@/components/ui/kit'
import { cellTableCls, CellBand, CellHead, CellInput, CellSelect, CellCalc, SummaryPill } from '@/components/ui/cell-grid'
import { Modal } from '@/components/ui/modal'

const won = (n: number) => n.toLocaleString('ko-KR')
const num = (s: string) => Number(s.replace(/[^\d.-]/g, '')) || 0

interface Row { code: string; name: string; kind: string; qty: string; price: string; disc: string; cost: string }
const ROWS: Row[] = [
  { code: '00-00-01', name: '예시 상품 가', kind: '직접', qty: '100', price: '8,400', disc: '50,000', cost: '5,800' },
  { code: '00-00-02', name: '예시 상품 나', kind: '직접', qty: '50', price: '9,200', disc: '', cost: '6,600' },
]
const LIST = [
  { date: '2026-11-25', no: 'D000000-005', vendor: '가나은행', branch: '역삼지점', person: '김민수 과장님', total: 1595000, due: 1595000, pay: ['red', '미결제'], po: ['green', '발주 완료'] },
  { date: '2026-11-25', no: 'D000000-004', vendor: '다라생명', branch: '강북센터', person: '이서연 님', total: 400000, due: 400000, pay: ['amber', '매칭 대기'], po: ['amber', '발주 대기'] },
  { date: '2026-11-24', no: 'D000000-003', vendor: '마바증권', branch: '본점 영업부', person: '박지훈 부장님', total: 8050000, due: 0, pay: ['green', '완료'], po: ['green', '발주 완료'] },
] as const

export default function UiKitPage() {
  const [kpi, setKpi] = useState('all')
  const [chip, setChip] = useState('all')
  const [rows, setRows] = useState(ROWS)
  const [modal, setModal] = useState(false)
  const set = (i: number, k: keyof Row, v: string) => setRows(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r))
  const calc = rows.map(r => { const sale = num(r.qty) * num(r.price) - num(r.disc); const buy = num(r.qty) * num(r.cost); return { sale, buy, margin: sale - buy } })
  const sum = calc.reduce((a, c) => ({ sale: a.sale + c.sale, buy: a.buy + c.buy, margin: a.margin + c.margin }), { sale: 0, buy: 0, margin: 0 })
  const disc = rows.reduce((a, r) => a + num(r.disc), 0)

  return (
    <Page>
      <PageHeader title="UI 통일 기준 견본" desc="공용 부품이 실제 화면에서 어떻게 보이는지 모아 둔 화면입니다. 데이터는 모두 예시입니다."
        actions={<><Button>엑셀 다운로드</Button><Button variant="primary">+ 주문 추가</Button></>} />

      <SectionTitle hint="제목 줄 → 탭 → 기간 → 요약 카드 → 검색 · 칩 → 표">1. 목록 화면</SectionTitle>
      <KpiGrid cols={5}>
        <KpiCard label="기간 주문" value="351건" sub="전체 보기" active={kpi === 'all'} onClick={() => setKpi('all')} />
        <KpiCard label="총 금액" value={won(263966730)} sub="원" />
        <KpiCard label="미수금" value={won(218511830)} sub="미결제 147건" tone="red" active={kpi === 'due'} onClick={() => setKpi('due')} />
        <KpiCard label="발주 대기" value="22건" sub="발주서 미작성" tone="amber" active={kpi === 'po'} onClick={() => setKpi('po')} />
        <KpiCard label="출고 완료" value="288건" sub="82%" tone="green" />
      </KpiGrid>
      <FilterRow>
        <Input fieldSize="sm" className="!w-72" placeholder="업체 · 지점 · 담당자 · 주문번호 검색" />
        {[['all', '전체', 351], ['unpaid', '미결제', 147], ['part', '일부 결제', 12], ['done', '완료', 192]].map(([k, l, n]) =>
          <Chip key={k} on={chip === k} count={n} onClick={() => setChip(String(k))}>{l}</Chip>)}
      </FilterRow>
      <TableCard>
        <table className={tbl.table}>
          <thead><tr>
            <th className={tbl.th}>주문일 / 번호</th><th className={tbl.th}>업체(은행)</th><th className={tbl.th}>부서(지점)</th><th className={tbl.th}>담당자</th>
            <th className={tbl.thNum}>총금액</th><th className={tbl.thNum}>미수금</th><th className={tbl.th}>결제</th><th className={tbl.th}>발주</th><th className={tbl.th} />
          </tr></thead>
          <tbody>
            {LIST.map(r => (
              <tr key={r.no} className={tbl.tr}>
                <td className={tbl.td}>{r.date}<span className={tbl.sub}>{r.no}</span></td>
                <td className={tbl.td}><span className={tbl.name}>{r.vendor}</span></td>
                <td className={tbl.td}>{r.branch}</td>
                <td className={tbl.td}>{r.person}</td>
                <td className={tbl.tdNum}>{won(r.total)}</td>
                <td className={`${tbl.tdNum} ${r.due ? tbl.neg : ''}`}>{won(r.due)}</td>
                <td className={tbl.td}><Badge tone={r.pay[0]}>{r.pay[1]}</Badge></td>
                <td className={tbl.td}><Badge tone={r.po[0]}>{r.po[1]}</Badge></td>
                <td className={tbl.tdNum}><Button size="sm">수금</Button></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className={tbl.foot}>
            <td className={tbl.td} colSpan={4}>합계 3건</td><td className={tbl.tdNum}>{won(10045000)}</td><td className={`${tbl.tdNum} ${tbl.neg}`}>{won(1995000)}</td><td colSpan={3} />
          </tr></tfoot>
        </table>
      </TableCard>

      <SectionTitle className="mt-8" hint="칸을 고치면 합계 · 마진이 다시 계산됩니다">2. 입력 표 — 엑셀형 셀 + 묶음 색</SectionTitle>
      <Card>
        <div className="flex gap-2 flex-wrap mb-2">
          <SummaryPill group="sale" label="판매합계">{won(sum.sale)}</SummaryPill>
          {disc > 0 && <SummaryPill group="sale" warn="red" label="판매할인">-{won(disc)}</SummaryPill>}
          <SummaryPill group="buy" label="매입합계">{won(sum.buy)}</SummaryPill>
          <SummaryPill group="result" warn={sum.margin < 0 ? 'red' : null} label="마진">{won(sum.margin)}{sum.sale > 0 && ` (${(sum.margin / sum.sale * 100).toFixed(1)}%)`}</SummaryPill>
        </div>
        <div className="overflow-x-auto">
          <table className={`${cellTableCls} w-full min-w-[980px]`}>
            <thead>
              <tr><CellBand group="item" colSpan={4} /><CellBand group="sale" colSpan={3} /><CellBand group="buy" colSpan={2} /><CellBand group="result" /></tr>
              <tr>
                <CellHead group="item">품번</CellHead><CellHead group="item" className="w-[24%]">상품명</CellHead><CellHead group="item" className="w-24">배송종류</CellHead><CellHead group="item">수량</CellHead>
                <CellHead group="sale">판매가</CellHead><CellHead group="sale">판매할인</CellHead><CellHead group="sale">판매합계</CellHead>
                <CellHead group="buy">매입가</CellHead><CellHead group="buy">매입합계</CellHead><CellHead group="result">마진</CellHead>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><CellInput group="item" value={r.code} onChange={e => set(i, 'code', e.target.value)} /></td>
                  <td><CellInput group="item" value={r.name} onChange={e => set(i, 'name', e.target.value)} /></td>
                  <td><CellSelect group="item" value={r.kind} onChange={e => set(i, 'kind', e.target.value)}><option>직접</option><option>택배</option><option>퀵</option></CellSelect></td>
                  <td><CellInput group="item" num value={r.qty} onChange={e => set(i, 'qty', e.target.value)} /></td>
                  <td><CellInput group="sale" num warn={i === 1 ? 'amber' : null} value={r.price} onChange={e => set(i, 'price', e.target.value)} /></td>
                  <td><CellInput group="sale" num warn={num(r.disc) > 0 ? 'red' : null} value={r.disc} onChange={e => set(i, 'disc', e.target.value)} /></td>
                  <td><CellCalc group="sale">{won(calc[i].sale)}</CellCalc></td>
                  <td><CellInput group="buy" num value={r.cost} onChange={e => set(i, 'cost', e.target.value)} /></td>
                  <td><CellCalc group="buy">{won(calc[i].buy)}</CellCalc></td>
                  <td><CellCalc group="result" warn={calc[i].margin < 0 ? 'red' : null}>{won(calc[i].margin)}</CellCalc></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-600">흰 칸 = 직접 입력(묶음 색 테두리) · 칠한 칸 = 자동 계산 · 빨간 칸 = 할인 · 품절 · 노란 칸 = 단가 변경</p>
      </Card>

      <SectionTitle className="mt-8" hint="테두리는 한 가지, 종류는 바탕으로">3. 입력 칸(양식)</SectionTitle>
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="주문일" required><Input type="date" defaultValue="2026-11-25" /></Field>
          <Field label="업체 (은행 그룹)" hint="목록에서 선택"><Input kind="pick" placeholder="업체 검색" /></Field>
          <Field label="지점(부서) — 주문처" required><Input kind="pick" placeholder="거래처 검색" /></Field>
          <Field label="대표번호" hint="자동"><Input kind="auto" defaultValue="02-000-0000" /></Field>
          <Field label="구분"><Select defaultValue="문의"><option>문의</option><option>견적</option><option>주문</option></Select></Field>
          <Field label="메모" className="md:col-span-3"><Textarea rows={2} placeholder="직접 입력" /></Field>
        </div>
        <p className="mt-3 text-xs text-slate-600">흰 = 직접 입력 · 옅은 노랑 = 목록에서 선택 · 회색 = 자동(못 고침) · 필수는 라벨의 빨간 별</p>
      </Card>

      <SectionTitle className="mt-8">4. 버튼 · 배지 · 창</SectionTitle>
      <Card>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button variant="primary">주 작업</Button><Button>그 밖의 조작</Button><Button variant="danger">삭제</Button><Button variant="link">자세히</Button>
          <a href="#" className={btnCls('secondary')}>링크를 버튼 모양으로</a>
          <span className="mx-2 text-xs text-slate-600">표 줄 안:</span>
          <Button variant="primary" size="sm">연결</Button><Button size="sm">수정</Button><Button variant="danger" size="sm">삭제</Button>
          <Button variant="primary" disabled>못 누름</Button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mt-3">
          <Badge tone="red">미결제 · 위험</Badge><Badge tone="amber">대기 · 주의</Badge><Badge tone="green">완료 · 정상</Badge><Badge tone="blue">정보 · 진행</Badge><Badge>해당 없음</Badge>
          <Button size="sm" className="ml-3" onClick={() => setModal(true)}>창 열어 보기</Button>
        </div>
      </Card>

      {modal && (
        <Modal title="수금 매칭 해제" desc="해제 사유를 골라 주세요. 이력에 남습니다." onClose={() => setModal(false)}
          footer={<><Button onClick={() => setModal(false)}>취소</Button><Button variant="danger" onClick={() => setModal(false)}>해제</Button></>}>
          <Field label="사유" required><Select defaultValue=""><option value="" disabled>사유 선택</option><option>잘못 붙임</option><option>금액 다름</option></Select></Field>
        </Modal>
      )}
    </Page>
  )
}
