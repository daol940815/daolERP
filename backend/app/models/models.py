from sqlalchemy import Column, Integer, String, DateTime, Date, Time, Numeric, Boolean, ForeignKey, Text, BigInteger
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base import Base


class Institution(Base):
    __tablename__ = "institutions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    type = Column(String(20), nullable=False)  # bank | card
    code = Column(String(20))
    created_at = Column(DateTime, server_default=func.now())

    accounts = relationship("Account", back_populates="institution")
    upload_histories = relationship("UploadHistory", back_populates="institution")


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    institution_id = Column(Integer, ForeignKey("institutions.id"))
    account_number = Column(String(100))
    account_name = Column(String(200))
    account_type = Column(String(50))
    currency = Column(String(10), default="KRW")
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    institution = relationship("Institution", back_populates="accounts")
    transactions = relationship("Transaction", back_populates="account")
    upload_histories = relationship("UploadHistory", back_populates="account")


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id"))
    transaction_date = Column(Date, nullable=False, index=True)
    transaction_time = Column(Time)
    description = Column(String(500))
    counterparty = Column(String(200))
    amount = Column(Numeric(18, 2), nullable=False)
    balance = Column(Numeric(18, 2))
    transaction_type = Column(String(20))  # deposit | withdrawal | card_purchase | card_cancel
    category = Column(String(100))
    memo = Column(String(500))
    hash_key = Column(String(64), unique=True, index=True)
    is_duplicate = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    account = relationship("Account", back_populates="transactions")
    logs = relationship("TransactionLog", back_populates="transaction")


class TransactionLog(Base):
    __tablename__ = "transaction_logs"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"))
    field_name = Column(String(100))
    old_value = Column(Text)
    new_value = Column(Text)
    changed_by = Column(String(100), default="system")
    changed_at = Column(DateTime, server_default=func.now())

    transaction = relationship("Transaction", back_populates="logs")


class UploadHistory(Base):
    __tablename__ = "upload_history"

    id = Column(Integer, primary_key=True, index=True)
    institution_id = Column(Integer, ForeignKey("institutions.id"))
    account_id = Column(Integer, ForeignKey("accounts.id"))
    filename = Column(String(500), nullable=False)
    file_size = Column(BigInteger)
    total_rows = Column(Integer, default=0)
    success_rows = Column(Integer, default=0)
    duplicate_rows = Column(Integer, default=0)
    error_rows = Column(Integer, default=0)
    status = Column(String(20), default="pending")  # pending | processing | completed | failed
    error_message = Column(Text)
    uploaded_at = Column(DateTime, server_default=func.now())
    completed_at = Column(DateTime)

    institution = relationship("Institution", back_populates="upload_histories")
    account = relationship("Account", back_populates="upload_histories")
