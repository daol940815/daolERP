from pydantic import BaseModel
from typing import Optional, List
from datetime import date, time, datetime
from decimal import Decimal


# Institution
class InstitutionBase(BaseModel):
    name: str
    type: str
    code: Optional[str] = None


class InstitutionResponse(InstitutionBase):
    id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Account
class AccountBase(BaseModel):
    institution_id: int
    account_number: Optional[str] = None
    account_name: Optional[str] = None
    account_type: Optional[str] = None
    currency: str = "KRW"


class AccountCreate(AccountBase):
    pass


class AccountResponse(AccountBase):
    id: int
    is_active: bool
    created_at: Optional[datetime] = None
    institution: Optional[InstitutionResponse] = None

    class Config:
        from_attributes = True


# Transaction
class TransactionBase(BaseModel):
    transaction_date: date
    transaction_time: Optional[time] = None
    description: Optional[str] = None
    counterparty: Optional[str] = None
    amount: Decimal
    balance: Optional[Decimal] = None
    transaction_type: Optional[str] = None
    category: Optional[str] = None
    memo: Optional[str] = None


class TransactionUpdate(BaseModel):
    category: Optional[str] = None
    memo: Optional[str] = None
    counterparty: Optional[str] = None


class TransactionResponse(TransactionBase):
    id: int
    account_id: int
    hash_key: Optional[str] = None
    is_duplicate: bool
    created_at: Optional[datetime] = None
    account: Optional[AccountResponse] = None

    class Config:
        from_attributes = True


# TransactionLog
class TransactionLogResponse(BaseModel):
    id: int
    transaction_id: int
    field_name: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    changed_by: str
    changed_at: datetime

    class Config:
        from_attributes = True


# Upload History
class UploadHistoryResponse(BaseModel):
    id: int
    institution_id: Optional[int] = None
    account_id: Optional[int] = None
    filename: str
    file_size: Optional[int] = None
    total_rows: int
    success_rows: int
    duplicate_rows: int
    error_rows: int
    status: str
    error_message: Optional[str] = None
    uploaded_at: datetime
    completed_at: Optional[datetime] = None
    institution: Optional[InstitutionResponse] = None

    class Config:
        from_attributes = True


# Upload Result
class UploadResult(BaseModel):
    upload_id: int
    filename: str
    total_rows: int
    success_rows: int
    duplicate_rows: int
    error_rows: int
    status: str
    errors: List[str] = []


# Dashboard Stats
class DashboardStats(BaseModel):
    total_transactions: int
    total_deposit: Decimal
    total_withdrawal: Decimal
    net_amount: Decimal
    institution_count: int
    account_count: int
    recent_upload_count: int


# Pagination
class PaginatedResponse(BaseModel):
    items: List
    total: int
    page: int
    size: int
    pages: int


# Transaction Filter
class TransactionFilter(BaseModel):
    institution_id: Optional[int] = None
    account_id: Optional[int] = None
    transaction_type: Optional[str] = None
    category: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    amount_min: Optional[Decimal] = None
    amount_max: Optional[Decimal] = None
    keyword: Optional[str] = None
    page: int = 1
    size: int = 50
