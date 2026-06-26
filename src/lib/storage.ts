// ─────────────────────────────────────────────────────────
// 파일 스토리지 추상화 (향후 첨부파일 대비)
//
// 현재 daolERP 는 엑셀 업로드를 "메모리에서 즉시 파싱 후 폐기" 하므로
// 디스크/스토리지에 파일을 저장하지 않습니다 (서버리스 배포에 안전).
//
// 향후 계약서·증빙 등 첨부파일을 보관해야 하면, 로컬 디스크가 아니라
// 오브젝트 스토리지(Cloudflare R2 / AWS S3 호환)에 저장해야 합니다.
// 그때 이 인터페이스의 구현체(S3StorageProvider 등)만 추가하면 되도록
// 애플리케이션 코드는 StorageProvider 인터페이스에만 의존하게 합니다.
// ─────────────────────────────────────────────────────────

export interface StorageProvider {
  /** 파일 저장 후 접근 키(또는 URL) 반환 */
  put(key: string, data: Buffer | Uint8Array, contentType?: string): Promise<string>;
  /** 파일 조회 */
  get(key: string): Promise<Buffer | null>;
  /** 파일 삭제 */
  delete(key: string): Promise<void>;
  /** 공개/서명 URL 생성 */
  url(key: string): Promise<string>;
}

/**
 * 아직 스토리지를 설정하지 않은 상태의 기본 구현.
 * 첨부파일 기능을 켜기 전까지는 호출 시 명확한 안내 에러를 던집니다.
 */
class NotConfiguredStorage implements StorageProvider {
  private fail(): never {
    throw new Error(
      "오브젝트 스토리지가 설정되지 않았습니다. 첨부파일 기능을 사용하려면 " +
        "STORAGE_* 환경변수를 설정하고 S3/R2 구현체를 연결하세요."
    );
  }
  async put() { return this.fail(); }
  async get() { return this.fail(); }
  async delete() { return this.fail(); }
  async url() { return this.fail(); }
}

let provider: StorageProvider | null = null;

// 환경변수가 설정되면 여기서 S3/R2 구현체를 반환하도록 확장합니다.
export function getStorage(): StorageProvider {
  if (provider) return provider;
  // 예) if (process.env.STORAGE_BUCKET) provider = new S3StorageProvider();
  provider = new NotConfiguredStorage();
  return provider;
}
