from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_, or_, func
from typing import Optional, List
from datetime import date
from decimal import Decimal

from app.db.session import get_db
from app.models.models import Transaction, TransactionLog, Account
from app.schemas.schemas import TransactionResponse, TransactionUpdate, TransactionLogResponse

router = APIRouter()


@router.get("/", response_model=dict)
def get_transactions(
    institution_id: Optional[int] = None,
    account_id: Optional[int] = None,
    transaction_type: Optional[str] = None,
    category: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    amount_min: Optional[float] = None,
    amount_max: Optional[float] = None,
    keyword: Optional[str] = None,
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    query = db.query(Transaction).options(
        joinedload(Transaction.account).joinedload(Account.institution)
    )

    filters = []

    if account_id:
        filters.append(Transaction.account_id == account_id)
    elif institution_id:
        account_ids = db.query(Account.id).filter(Account.institution_id == institution_id).subquery()
        filters.append(Transaction.account_id.in_(account_ids))

    if transaction_type:
        filters.append(Transaction.transaction_type == transaction_type)
    if category:
        filters.append(Transaction.category == category)
    if date_from:
        filters.append(Transaction.transaction_date >= date_from)
    if date_to:
        filters.append(Transaction.transaction_date <= date_to)
    if amount_min is not None:
        filters.append(Transaction.amount >= amount_min)
    if amount_max is not None:
        filters.append(Transaction.amount <= amount_max)
    if keyword:
        filters.append(or_(
            Transaction.description.ilike(f"%{keyword}%"),
            Transaction.counterparty.ilike(f"%{keyword}%"),
            Transaction.memo.ilike(f"%{keyword}%"),
        ))

    if filters:
        query = query.filter(and_(*filters))

    total = query.count()
    items = query.order_by(Transaction.transaction_date.desc()).offset((page - 1) * size).limit(size).all()

    return {
        "items": [TransactionResponse.model_validate(t) for t in items],
        "total": total,
        "page": page,
        "size": size,
        "pages": (total + size - 1) // size,
    }


@router.get("/{transaction_id}", response_model=TransactionResponse)
def get_transaction(transaction_id: int, db: Session = Depends(get_db)):
    tx = db.query(Transaction).options(
        joinedload(Transaction.account).joinedload(Account.institution)
    ).filter(Transaction.id == transaction_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="거래내역을 찾을 수 없습니다")
    return tx


@router.patch("/{transaction_id}", response_model=TransactionResponse)
def update_transaction(
    transaction_id: int,
    update_data: TransactionUpdate,
    db: Session = Depends(get_db),
):
    tx = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="거래내역을 찾을 수 없습니다")

    for field, new_value in update_data.model_dump(exclude_none=True).items():
        old_value = getattr(tx, field)
        if old_value != new_value:
            log = TransactionLog(
                transaction_id=tx.id,
                field_name=field,
                old_value=str(old_value) if old_value is not None else None,
                new_value=str(new_value),
            )
            db.add(log)
            setattr(tx, field, new_value)

    db.commit()
    db.refresh(tx)
    return tx


@router.get("/{transaction_id}/logs", response_model=List[TransactionLogResponse])
def get_transaction_logs(transaction_id: int, db: Session = Depends(get_db)):
    return db.query(TransactionLog).filter(
        TransactionLog.transaction_id == transaction_id
    ).order_by(TransactionLog.changed_at.desc()).all()
