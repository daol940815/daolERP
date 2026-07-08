export function PlaceholderPage({ title, milestone }: { title: string; milestone: string }) {
  return (
    <>
      <h2>{title}</h2>
      <div className="card placeholder">{milestone} 단계에서 구현 예정입니다.</div>
    </>
  );
}
