from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from decimal import Decimal
from datetime import date, timedelta

from app.db.session import get_db
from app.models.models import Transaction, Account, Institution, UploadHistory
from app.schemas.schemas import DashboardStats

router = APIRouter()


@router.get("/stats", response_model=DashboardStats)
def get_dashboard_stats(db: Session = Depends(get_db)):
    total_transactions = db.query(func.count(Transaction.id)).scalar() or 0

    deposit_result = db.query(func.sum(Transaction.amount)).filter(
        Transaction.amount > 0
    ).scalar()
    total_deposit = deposit_result or Decimal("0")

    withdrawal_result = db.query(func.sum(Transaction.amount)).filter(
        Transaction.amount < 0
    ).scalar()
    total_withdrawal = abs(withdrawal_result) if withdrawal_result else Decimal("0")

    net_amount = total_deposit - total_withdrawal

    institution_count = db.query(func.count(Institution.id)).scalar() or 0
    account_count = db.query(func.count(Account.id)).filter(Account.is_active == True).scalar() or 0

    recent_date = date.today() - timedelta(days=7)
    recent_upload_count = db.query(func.count(UploadHistory.id)).filter(
        UploadHistory.uploaded_at >= recent_date
    ).scalar() or 0

    return DashboardStats(
        total_transactions=total_transactions,
        total_deposit=total_deposit,
        total_withdrawal=total_withdrawal,
        net_amount=net_amount,
        institution_count=institution_count,
        account_count=account_count,
        recent_upload_count=recent_upload_count,
    )


@router.get("/monthly")
def get_monthly_summary(
    year: int = None,
    db: Session = Depends(get_db),
):
    if not year:
        year = date.today().year

    results = db.query(
        func.extract('month', Transaction.transaction_date).label('month'),
        func.sum(func.case((Transaction.amount > 0, Transaction.amount), else_=0)).label('deposit'),
        func.sum(func.case((Transaction.amount < 0, Transaction.amount), else_=0)).label('withdrawal'),
        func.count(Transaction.id).label('count'),
    ).filter(
        func.extract('year', Transaction.transaction_date) == year
    ).group_by(
        func.extract('month', Transaction.transaction_date)
    ).order_by('month').all()

    return [
        {
            "month": int(r.month),
            "deposit": float(r.deposit or 0),
            "withdrawal": float(abs(r.withdrawal or 0)),
            "count": r.count,
        }
        for r in results
    ]


@router.get("/by-institution")
def get_by_institution(db: Session = Depends(get_db)):
    results = db.query(
        Institution.name,
        Institution.type,
        func.count(Transaction.id).label('count'),
        func.sum(func.case((Transaction.amount > 0, Transaction.amount), else_=0)).label('deposit'),
        func.sum(func.case((Transaction.amount < 0, Transaction.amount), else_=0)).label('withdrawal'),
    ).join(
        Account, Account.institution_id == Institution.id
    ).join(
        Transaction, Transaction.account_id == Account.id
    ).group_by(Institution.id, Institution.name, Institution.type).all()

    return [
        {
            "name": r.name,
            "type": r.type,
            "count": r.count,
            "deposit": float(r.deposit or 0),
            "withdrawal": float(abs(r.withdrawal or 0)),
        }
        for r in results
    ]
