-- FinBook 초기 데이터베이스 설정

-- 금융기관 테이블
CREATE TABLE IF NOT EXISTS institutions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('bank', 'card')),
    code VARCHAR(20),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 계좌 테이블
CREATE TABLE IF NOT EXISTS accounts (
    id SERIAL PRIMARY KEY,
    institution_id INTEGER REFERENCES institutions(id),
    account_number VARCHAR(100),
    account_name VARCHAR(200),
    account_type VARCHAR(50),
    currency VARCHAR(10) DEFAULT 'KRW',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 거래내역 테이블
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id),
    transaction_date DATE NOT NULL,
    transaction_time TIME,
    description VARCHAR(500),
    counterparty VARCHAR(200),
    amount DECIMAL(18, 2) NOT NULL,
    balance DECIMAL(18, 2),
    transaction_type VARCHAR(20) CHECK (transaction_type IN ('deposit', 'withdrawal', 'card_purchase', 'card_cancel')),
    category VARCHAR(100),
    memo VARCHAR(500),
    hash_key VARCHAR(64) UNIQUE,
    is_duplicate BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 거래 수정 이력 테이블
CREATE TABLE IF NOT EXISTS transaction_logs (
    id SERIAL PRIMARY KEY,
    transaction_id INTEGER REFERENCES transactions(id),
    field_name VARCHAR(100),
    old_value TEXT,
    new_value TEXT,
    changed_by VARCHAR(100) DEFAULT 'system',
    changed_at TIMESTAMP DEFAULT NOW()
);

-- 파일 업로드 이력 테이블
CREATE TABLE IF NOT EXISTS upload_history (
    id SERIAL PRIMARY KEY,
    institution_id INTEGER REFERENCES institutions(id),
    account_id INTEGER REFERENCES accounts(id),
    filename VARCHAR(500) NOT NULL,
    file_size BIGINT,
    total_rows INTEGER DEFAULT 0,
    success_rows INTEGER DEFAULT 0,
    duplicate_rows INTEGER DEFAULT 0,
    error_rows INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    uploaded_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- 금융기관 기초 데이터 입력
INSERT INTO institutions (name, type, code) VALUES
    ('하나은행', 'bank', 'HANA'),
    ('국민은행', 'bank', 'KB'),
    ('신한은행', 'bank', 'SHIN'),
    ('우리은행', 'bank', 'WOORI'),
    ('기업은행', 'bank', 'IBK'),
    ('하나카드', 'card', 'HANA_CARD'),
    ('삼성카드', 'card', 'SAMSUNG'),
    ('신한카드', 'card', 'SHIN_CARD'),
    ('현대카드', 'card', 'HYUNDAI'),
    ('롯데카드', 'card', 'LOTTE'),
    ('KB국민카드', 'card', 'KB_CARD')
ON CONFLICT (name) DO NOTHING;

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_hash ON transactions(hash_key);
CREATE INDEX IF NOT EXISTS idx_upload_history_institution ON upload_history(institution_id);
