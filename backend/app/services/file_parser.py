import pandas as pd
import hashlib
from datetime import datetime
from typing import Optional
from io import BytesIO


def generate_hash_key(account_id: int, transaction_date: str, amount: float, description: str) -> str:
    raw = f"{account_id}|{transaction_date}|{amount}|{description}"
    return hashlib.sha256(raw.encode()).hexdigest()


def parse_bank_excel(file_content: bytes, institution_name: str, account_id: int) -> list[dict]:
    """은행 거래내역 엑셀 파싱 - 기관별 컬럼 매핑 처리"""
    df = pd.read_excel(BytesIO(file_content), header=None)

    # 헤더 행 찾기 (날짜 포함된 행)
    header_row = 0
    for i, row in df.iterrows():
        row_str = " ".join(str(v) for v in row.values if pd.notna(v))
        if any(kw in row_str for kw in ["거래일", "날짜", "거래일자", "일자"]):
            header_row = i
            break

    df = pd.read_excel(BytesIO(file_content), header=header_row)
    df.columns = [str(c).strip() for c in df.columns]

    column_maps = {
        "하나은행": {
            "date": ["거래일자", "날짜", "거래일"],
            "time": ["거래시각", "시각", "시간"],
            "description": ["적요", "거래내용", "내용"],
            "counterparty": ["거래처", "상대방"],
            "withdrawal": ["출금액", "출금"],
            "deposit": ["입금액", "입금"],
            "balance": ["잔액"],
        },
        "국민은행": {
            "date": ["거래일자", "날짜"],
            "time": ["거래시간", "시간"],
            "description": ["거래내용", "적요"],
            "counterparty": ["기재내용"],
            "withdrawal": ["출금액"],
            "deposit": ["입금액"],
            "balance": ["잔액"],
        },
        "신한은행": {
            "date": ["거래일", "거래일자"],
            "time": ["거래시각"],
            "description": ["적요"],
            "counterparty": ["거래처"],
            "withdrawal": ["출금"],
            "deposit": ["입금"],
            "balance": ["잔액"],
        },
        "우리은행": {
            "date": ["거래일자"],
            "time": ["거래시간"],
            "description": ["거래내용"],
            "counterparty": ["내용"],
            "withdrawal": ["출금금액"],
            "deposit": ["입금금액"],
            "balance": ["잔액"],
        },
        "기업은행": {
            "date": ["거래일자"],
            "time": ["시각"],
            "description": ["거래내용", "적요"],
            "counterparty": ["거래처명"],
            "withdrawal": ["출금액"],
            "deposit": ["입금액"],
            "balance": ["잔액"],
        },
    }

    col_map = column_maps.get(institution_name, column_maps["하나은행"])

    def find_col(candidates: list) -> Optional[str]:
        for c in candidates:
            if c in df.columns:
                return c
        return None

    date_col = find_col(col_map["date"])
    time_col = find_col(col_map.get("time", []))
    desc_col = find_col(col_map["description"])
    counter_col = find_col(col_map.get("counterparty", []))
    withdrawal_col = find_col(col_map["withdrawal"])
    deposit_col = find_col(col_map["deposit"])
    balance_col = find_col(col_map["balance"])

    transactions = []
    for _, row in df.iterrows():
        if date_col is None or pd.isna(row.get(date_col)):
            continue

        try:
            tx_date = pd.to_datetime(str(row[date_col])).date()
        except Exception:
            continue

        withdrawal = _to_float(row.get(withdrawal_col)) if withdrawal_col else 0
        deposit = _to_float(row.get(deposit_col)) if deposit_col else 0

        if withdrawal and withdrawal > 0:
            amount = -abs(withdrawal)
            tx_type = "withdrawal"
        elif deposit and deposit > 0:
            amount = abs(deposit)
            tx_type = "deposit"
        else:
            continue

        description = str(row[desc_col]).strip() if desc_col and pd.notna(row.get(desc_col)) else ""
        counterparty = str(row[counter_col]).strip() if counter_col and pd.notna(row.get(counter_col)) else ""
        balance = _to_float(row.get(balance_col)) if balance_col else None

        tx_time = None
        if time_col and pd.notna(row.get(time_col)):
            try:
                tx_time = pd.to_datetime(str(row[time_col])).time()
            except Exception:
                pass

        hash_key = generate_hash_key(account_id, str(tx_date), amount, description)

        transactions.append({
            "account_id": account_id,
            "transaction_date": tx_date,
            "transaction_time": tx_time,
            "description": description,
            "counterparty": counterparty,
            "amount": amount,
            "balance": balance,
            "transaction_type": tx_type,
            "hash_key": hash_key,
        })

    return transactions


def parse_card_excel(file_content: bytes, institution_name: str, account_id: int) -> list[dict]:
    """카드 이용내역 엑셀 파싱"""
    df = pd.read_excel(BytesIO(file_content), header=None)

    header_row = 0
    for i, row in df.iterrows():
        row_str = " ".join(str(v) for v in row.values if pd.notna(v))
        if any(kw in row_str for kw in ["이용일", "승인일", "날짜"]):
            header_row = i
            break

    df = pd.read_excel(BytesIO(file_content), header=header_row)
    df.columns = [str(c).strip() for c in df.columns]

    column_maps = {
        "default": {
            "date": ["이용일", "승인일자", "거래일자", "날짜"],
            "description": ["가맹점명", "이용가맹점", "내용", "적요"],
            "amount": ["이용금액", "승인금액", "금액"],
            "cancel": ["취소여부", "구분"],
        }
    }

    col_map = column_maps["default"]

    def find_col(candidates):
        for c in candidates:
            if c in df.columns:
                return c
        return None

    date_col = find_col(col_map["date"])
    desc_col = find_col(col_map["description"])
    amount_col = find_col(col_map["amount"])
    cancel_col = find_col(col_map.get("cancel", []))

    transactions = []
    for _, row in df.iterrows():
        if date_col is None or pd.isna(row.get(date_col)):
            continue

        try:
            tx_date = pd.to_datetime(str(row[date_col])).date()
        except Exception:
            continue

        amount = _to_float(row.get(amount_col)) if amount_col else None
        if not amount:
            continue

        is_cancel = False
        if cancel_col and pd.notna(row.get(cancel_col)):
            cancel_val = str(row[cancel_col]).strip()
            is_cancel = cancel_val in ["취소", "Y", "yes", "TRUE"]

        tx_type = "card_cancel" if is_cancel else "card_purchase"
        final_amount = abs(amount) if is_cancel else -abs(amount)

        description = str(row[desc_col]).strip() if desc_col and pd.notna(row.get(desc_col)) else ""
        hash_key = generate_hash_key(account_id, str(tx_date), final_amount, description)

        transactions.append({
            "account_id": account_id,
            "transaction_date": tx_date,
            "transaction_time": None,
            "description": description,
            "counterparty": description,
            "amount": final_amount,
            "balance": None,
            "transaction_type": tx_type,
            "hash_key": hash_key,
        })

    return transactions


def _to_float(val) -> Optional[float]:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    try:
        return float(str(val).replace(",", "").replace(" ", ""))
    except Exception:
        return None
